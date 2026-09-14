begin;

create table if not exists public.scenza_state (
  id text primary key check (id = 'auth'),
  revision bigint not null default 0 check (revision >= 0),
  payload jsonb not null check (
    payload ?& array['accounts', 'events', 'promos', 'processed']
    and jsonb_typeof(payload->'accounts') = 'array'
    and jsonb_typeof(payload->'events') = 'array'
    and jsonb_typeof(payload->'promos') = 'array'
    and jsonb_typeof(payload->'processed') = 'array'
  )
);

alter table public.scenza_state enable row level security;
revoke all on table public.scenza_state from anon, authenticated;
grant select, insert, update on table public.scenza_state to service_role;

commit;
