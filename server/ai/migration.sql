-- Run once in the Supabase SQL editor before enabling the remote video worker.
-- owner_id refers to SCENZA's server-side account IDs, not Supabase Auth UUIDs.
create table if not exists public.scenza_video_projects (
  id text primary key,
  owner_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scenza_video_projects_owner on public.scenza_video_projects(owner_id);
create table if not exists public.scenza_video_jobs (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  project_id text not null references public.scenza_video_projects(id),
  type text not null check (type in ('preprocess','analyze','preview','revise','export','asset')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','error')),
  stage text not null default 'queued',
  progress double precision check (progress between 0 and 100),
  attempts integer not null default 0,
  result jsonb,
  error text,
  worker_id text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scenza_video_jobs_queue on public.scenza_video_jobs(status,created_at);
create unique index if not exists scenza_video_one_active on public.scenza_video_jobs(project_id) where status in ('queued','running');
alter table public.scenza_video_projects enable row level security;
alter table public.scenza_video_jobs enable row level security;
revoke all on public.scenza_video_projects,public.scenza_video_jobs from anon,authenticated;
grant select,insert,update on public.scenza_video_projects,public.scenza_video_jobs to service_role;

create or replace function public.scenza_video_save_project(p_owner text,p_id text,p_payload jsonb)
returns setof public.scenza_video_projects language sql set search_path = public as $$
  insert into scenza_video_projects(id,owner_id,payload) values(p_id,p_owner,p_payload)
  on conflict(id) do update set payload=excluded.payload,updated_at=now()
  where scenza_video_projects.owner_id=excluded.owner_id returning *;
$$;
create or replace function public.scenza_video_enqueue(p_owner text,p_project text,p_type text,p_payload jsonb)
returns setof public.scenza_video_jobs language sql set search_path = public as $$
  with queued as (
    insert into scenza_video_jobs(owner_id,project_id,type,payload)
    select p_owner,p_project,p_type,p_payload from scenza_video_projects where id=p_project and owner_id=p_owner returning *
  ), updated as (
    update scenza_video_projects p set payload=p.payload || jsonb_build_object(
      'jobId',q.id,'status',case q.type when 'preprocess' then 'PREPROCESSING' when 'analyze' then 'ANALYZING' when 'export' then 'EXPORTING' else 'RENDERING' end,
      'error',null,'updatedAt',q.updated_at),updated_at=now()
    from queued q where p.id=q.project_id and p.owner_id=q.owner_id
  ) select * from queued;
$$;
create or replace function public.scenza_video_claim(p_worker text)
returns setof public.scenza_video_jobs language plpgsql set search_path = public as $$
declare job_id text;
begin
  -- Serialize the short claim transaction; long video processing holds no DB lock.
  perform pg_advisory_xact_lock(1935893878,1);
  return query select j.* from scenza_video_jobs j
    where j.status='running' and j.worker_id=p_worker and j.lease_until>now()
    order by j.created_at,j.id limit 1;
  if found then return; end if;
  with exhausted as (
    update scenza_video_jobs set status='error',stage='error',error='Задача прервана после трёх попыток. Повторите запуск.',worker_id=null,lease_until=null,updated_at=now()
    where status='running' and lease_until<=now() and attempts>=3 returning *
  ) update scenza_video_projects p set payload=p.payload || jsonb_build_object('status','FAILED','error',e.error,'updatedAt',e.updated_at),updated_at=now()
    from exhausted e where p.id=e.project_id and p.owner_id=e.owner_id and p.payload->>'jobId'=e.id;
  update scenza_video_jobs set status='queued',worker_id=null,lease_until=null
    where status='running' and lease_until<=now();
  select j.id into job_id from scenza_video_jobs j where j.status='queued'
    and not exists(select 1 from scenza_video_jobs active where active.project_id=j.project_id and active.status='running')
    order by j.created_at,j.id limit 1 for update skip locked;
  if job_id is null then return; end if;
  return query update scenza_video_jobs set status='running',stage='starting',progress=null,attempts=attempts+1,error=null,
    worker_id=p_worker,lease_until=now()+interval '10 minutes',updated_at=now() where id=job_id returning *;
end;
$$;
create or replace function public.scenza_video_heartbeat(p_id text,p_worker text,p_stage text,p_progress double precision)
returns setof public.scenza_video_jobs language sql set search_path = public as $$
  update scenza_video_jobs set stage=coalesce(p_stage,stage),progress=p_progress,lease_until=now()+interval '10 minutes',updated_at=now()
  where id=p_id and worker_id=p_worker and status='running' and lease_until>now() returning *;
$$;
create or replace function public.scenza_video_finish(p_id text,p_worker text,p_error text,p_result jsonb)
returns setof public.scenza_video_jobs language sql set search_path = public as $$
  update scenza_video_jobs set status=case when p_error is null then 'done' else 'error' end,
    stage=case when p_error is null then 'done' else 'error' end,progress=case when p_error is null then 100 else null end,
    error=p_error,result=p_result,worker_id=null,lease_until=null,updated_at=now()
  where id=p_id and worker_id=p_worker and status='running' and lease_until>now() returning *;
$$;
create or replace function public.scenza_video_retry(p_owner text,p_id text)
returns setof public.scenza_video_jobs language sql set search_path = public as $$
  with queued as (
    update scenza_video_jobs set status='queued',stage='queued',progress=null,error=null,result=null,worker_id=null,lease_until=null,updated_at=now()
    where id=p_id and owner_id=p_owner and status='error' returning *
  ), updated as (
    update scenza_video_projects p set payload=p.payload || jsonb_build_object(
      'jobId',q.id,'status',case q.type when 'preprocess' then 'PREPROCESSING' when 'analyze' then 'ANALYZING' when 'export' then 'EXPORTING' else 'RENDERING' end,
      'error',null,'updatedAt',q.updated_at),updated_at=now()
    from queued q where p.id=q.project_id and p.owner_id=q.owner_id
  ) select * from queued;
$$;

revoke all on function public.scenza_video_save_project(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.scenza_video_enqueue(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.scenza_video_claim(text) from public,anon,authenticated;
revoke all on function public.scenza_video_heartbeat(text,text,text,double precision) from public,anon,authenticated;
revoke all on function public.scenza_video_finish(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.scenza_video_retry(text,text) from public,anon,authenticated;
grant execute on function public.scenza_video_save_project(text,text,jsonb) to service_role;
grant execute on function public.scenza_video_enqueue(text,text,text,jsonb) to service_role;
grant execute on function public.scenza_video_claim(text) to service_role;
grant execute on function public.scenza_video_heartbeat(text,text,text,double precision) to service_role;
grant execute on function public.scenza_video_finish(text,text,text,jsonb) to service_role;
grant execute on function public.scenza_video_retry(text,text) to service_role;

-- Admin controls and actual provider usage. Apply this extension on existing deployments too.
create table if not exists public.scenza_ai_usage (id text primary key,payload jsonb not null);
create index if not exists scenza_ai_usage_owner_month on public.scenza_ai_usage ((payload->>'ownerId'), (left(payload->>'createdAt',7)));
alter table public.scenza_ai_usage enable row level security;
revoke all on public.scenza_ai_usage from anon,authenticated;
grant select,insert on public.scenza_ai_usage to service_role;
grant delete on public.scenza_video_jobs to service_role;
create or replace function public.scenza_video_record_usage(p_id text,p_payload jsonb)
returns void language sql set search_path = public as $$
  insert into scenza_ai_usage(id,payload) values(p_id,p_payload) on conflict(id) do nothing;
$$;
create or replace function public.scenza_video_admin_job(p_id text,p_action text)
returns jsonb language plpgsql set search_path = public as $$
declare j scenza_video_jobs; message text;
begin
  if p_action not in ('retry','cancel','delete') then raise exception 'Invalid job action'; end if;
  perform pg_advisory_xact_lock(1935893878,1);
  select * into j from scenza_video_jobs where id=p_id for update;
  if not found then raise exception 'Job not found'; end if;
  if j.status<>'error' and not (j.status='running' and coalesce(j.lease_until,'-infinity'::timestamptz)<=now())
    and not (j.status='queued' and j.updated_at<now()-interval '10 minutes') then
    raise exception 'Live job lease is protected' using errcode='23505';
  end if;
  if p_action='retry' then
    update scenza_video_jobs set status='queued',stage='queued',progress=null,error=null,result=null,worker_id=null,lease_until=null,attempts=0,updated_at=now() where id=p_id;
    update scenza_video_projects set payload=payload||jsonb_build_object('jobId',p_id,'status',case j.type when 'preprocess' then 'PREPROCESSING' when 'analyze' then 'ANALYZING' when 'export' then 'EXPORTING' else 'RENDERING' end,'error',null,'updatedAt',now()),updated_at=now()
      where id=j.project_id and owner_id=j.owner_id;
  else
    message:=case p_action when 'delete' then 'Ошибочная задача удалена владельцем. Можно запустить обработку снова.' else 'Обработка отменена владельцем.' end;
    if p_action='delete' then delete from scenza_video_jobs where id=p_id;
    else update scenza_video_jobs set status='error',stage='cancelled',error=message,worker_id=null,lease_until=null,updated_at=now() where id=p_id; end if;
    update scenza_video_projects set payload=payload||jsonb_build_object('status','FAILED','error',message,'updatedAt',now())||case p_action when 'delete' then jsonb_build_object('jobId',null) else '{}'::jsonb end,updated_at=now()
      where id=j.project_id and owner_id=j.owner_id and payload->>'jobId'=p_id;
  end if;
  return jsonb_build_object('id',p_id,'action',p_action,'status',case p_action when 'retry' then 'queued' when 'delete' then 'deleted' else 'cancelled' end);
end;
$$;
revoke all on function public.scenza_video_record_usage(text,jsonb) from public,anon,authenticated;
revoke all on function public.scenza_video_admin_job(text,text) from public,anon,authenticated;
grant execute on function public.scenza_video_record_usage(text,jsonb) to service_role;
grant execute on function public.scenza_video_admin_job(text,text) to service_role;
