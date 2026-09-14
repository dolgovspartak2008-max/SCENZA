import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const leaseMs = 10 * 60 * 1000;
const jobTypes = new Set(['preprocess', 'analyze', 'preview', 'revise', 'export', 'asset']);
const busyProject = () => Object.assign(new Error('Для проекта уже выполняется задача'), { status: 409 });
const queuedStatus = type => ({ preprocess: 'PREPROCESSING', analyze: 'ANALYZING', export: 'EXPORTING' })[type] || 'RENDERING';
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const toJob = row => row ? {
  id: row.id, ownerId: row.owner_id, projectId: row.project_id, type: row.type,
  payload: decode(row.payload), status: row.status, stage: row.stage, progress: row.progress,
  attempts: row.attempts, result: row.result == null ? null : decode(row.result), error: row.error,
  createdAt: row.created_at, updatedAt: row.updated_at,
} : null;
function identity(value) {
  if (typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f]/.test(value)) throw new Error('Invalid record identity');
  return value;
}
function projectValue(ownerId, project) {
  identity(ownerId); identity(project?.id);
  return { ...project, ownerId, createdAt: project.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function progressValue(value) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Invalid job progress');
  return value;
}
const adminJob = row => {
  const { payload, result, ...job } = toJob(row);
  const lease = typeof row.lease_until === 'number' ? row.lease_until : Date.parse(row.lease_until);
  return { ...job, stalled: row.status === 'running' ? !lease || lease <= Date.now() : row.status === 'queued' && Date.parse(row.updated_at) < Date.now() - leaseMs };
};
const adminProject = project => ({ id: project.id, ownerId: project.ownerId, status: project.status, duration: project.duration || 0, createdAt: project.createdAt, updatedAt: project.updatedAt, analyzedAt: project.analyzedAt || null, model: project.analysisModel || null, editRequests: Object.keys(project.editCache || {}).length, clips: [...(project.candidates || []).filter(item => item.ready), ...(project.exports || (project.finalFile ? [{ createdAt: project.updatedAt }] : []))].map(item => ({ createdAt: item.createdAt || project.createdAt })) });
function usageValue(value) {
  const number = key => Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null;
  const createdAt = typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) ? new Date(value.createdAt).toISOString() : new Date().toISOString();
  return { id: identity(value.id || randomUUID()), ownerId: identity(value.ownerId), projectId: identity(value.projectId), jobId: identity(value.jobId), kind: ['source', 'edit'].includes(value.kind) ? value.kind : 'ai', operation: String(value.operation || '').slice(0, 40), sourceSeconds: number('sourceSeconds'), model: String(value.model || '').slice(0, 120), inputTokens: number('inputTokens'), outputTokens: number('outputTokens'), totalTokens: number('totalTokens'), cost: number('cost'), error: value.error ? String(value.error).slice(0, 120) : null, createdAt };
}

function usageMonth(month = new Date().toISOString().slice(0, 7)) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid usage month');
  return month;
}
function monthlyUsage(rows, month) {
  const totals = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, unknownCostCalls: 0 });
  const result = { month, sourceMinutes: 0, sourceCount: 0, editRequests: 0, ...totals(), models: [] }, models = new Map();
  for (const record of rows) {
    if (!record.createdAt?.startsWith(month + '-')) continue;
    if (record.kind === 'source') { result.sourceMinutes += (record.sourceSeconds || 0) / 60; result.sourceCount++; continue; }
    if (record.kind === 'edit') { result.editRequests++; continue; }
    if (!models.has(record.model)) models.set(record.model, { model: record.model, ...totals() });
    for (const value of [result, models.get(record.model)]) {
      value.calls++;
      for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cost']) value[key] += record[key] || 0;
      if (record.cost == null) value.unknownCostCalls++;
    }
  }
  result.models = [...models.values()];
  return result;
}

export async function createStore({ dataDir, env = process.env }) {
  if (env.SUPABASE_URL || env.SUPABASE_SECRET_KEY) return supabaseStore(env);
  await mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'video-jobs.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, type TEXT NOT NULL,
      payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'queued',
      progress REAL, attempts INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT, worker_id TEXT, lease_until INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active ON jobs(project_id) WHERE status IN ('queued','running');
    CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  const transaction = action => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const get = (ownerId, id) => db.prepare('SELECT * FROM projects WHERE owner_id=? AND id=?').get(identity(ownerId), identity(id));
  const publishQueuedJob = row => {
    const project = decode(get(row.owner_id, row.project_id).payload);
    Object.assign(project, { jobId: row.id, status: queuedStatus(row.type), error: null, updatedAt: row.updated_at });
    db.prepare('UPDATE projects SET payload=? WHERE id=? AND owner_id=?').run(JSON.stringify(project), row.project_id, row.owner_id);
    return toJob(row);
  };
  const leaseUpdate = (jobId, workerId, sql, values) => {
    const row = db.prepare(`${sql} WHERE id=? AND worker_id=? AND status='running' AND lease_until>? RETURNING *`).get(...values, identity(jobId), identity(workerId), Date.now());
    if (!row) throw new Error('Job lease lost');
    return toJob(row);
  };
  let closed = false;
  return {
    async adminSnapshot() {
      return { projects: db.prepare('SELECT payload FROM projects').all().map(row => adminProject(decode(row.payload))), jobs: db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all().map(adminJob), usage: db.prepare('SELECT payload FROM ai_usage').all().map(row => decode(row.payload)) };
    },
    async recordAiUsage(value) { const record = usageValue(value); db.prepare('INSERT OR IGNORE INTO ai_usage(id,payload) VALUES(?,?)').run(record.id, JSON.stringify(record)); },
    async ownerMonthlyUsage(ownerId, month) {
      month = usageMonth(month);
      const rows = db.prepare("SELECT payload FROM ai_usage WHERE json_extract(payload,'$.ownerId')=? AND substr(json_extract(payload,'$.createdAt'),1,7)=?").all(identity(ownerId), month);
      return monthlyUsage(rows.map(row => decode(row.payload)), month);
    },
    async adminJobAction(id, action) {
      identity(id);
      if (!['retry', 'cancel', 'delete'].includes(action)) throw new Error('Invalid job action');
      return transaction(() => {
        const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
        if (!row) throw Object.assign(new Error('Задача не найдена.'), { status: 404 });
        if (row.status !== 'error' && !adminJob(row).stalled) throw Object.assign(new Error('Действие доступно только для ошибочной или зависшей задачи. Активная аренда worker защищена.'), { status: 409 });
        const timestamp = new Date().toISOString();
        if (action === 'retry') {
          if (db.prepare("SELECT id FROM jobs WHERE project_id=? AND id<>? AND status IN ('queued','running')").get(row.project_id, id)) throw busyProject();
          const queued = db.prepare("UPDATE jobs SET status='queued',stage='queued',progress=NULL,error=NULL,result=NULL,worker_id=NULL,lease_until=NULL,attempts=0,updated_at=? WHERE id=? RETURNING *").get(timestamp, id);
          publishQueuedJob(queued);
          return adminJob(queued);
        }
        const error = action === 'delete' ? 'Ошибочная задача удалена владельцем. Можно запустить обработку снова.' : 'Обработка отменена владельцем.';
        if (action === 'delete') db.prepare('DELETE FROM jobs WHERE id=?').run(id);
        else db.prepare("UPDATE jobs SET status='error',stage='cancelled',error=?,worker_id=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(error, timestamp, id);
        const projectRow = get(row.owner_id, row.project_id);
        if (projectRow) {
          const project = decode(projectRow.payload);
          if (project.jobId === id) { Object.assign(project, { status: 'FAILED', error, updatedAt: timestamp, ...(action === 'delete' ? { jobId: null } : {}) }); db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(project), row.project_id); }
        }
        return { id, action, status: action === 'delete' ? 'deleted' : 'cancelled' };
      });
    },
    async listProjects(ownerId) { return db.prepare('SELECT payload FROM projects WHERE owner_id=? ORDER BY rowid DESC').all(identity(ownerId)).map(row => decode(row.payload)); },
    async getProject(ownerId, id) { const row = get(ownerId, id); return row ? decode(row.payload) : null; },
    async saveProject(ownerId, project) {
      const value = projectValue(ownerId, project);
      const row = db.prepare(`INSERT INTO projects(id,owner_id,payload) VALUES(?,?,?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE projects.owner_id=excluded.owner_id RETURNING id`).get(value.id, ownerId, JSON.stringify(value));
      if (!row) throw new Error('Project owner access denied');
      return value;
    },
    async enqueue(ownerId, projectId, type, payload = {}) {
      if (!jobTypes.has(type)) throw new Error('Invalid job type');
      if (!get(ownerId, projectId)) throw new Error('Project not found');
      const now = new Date().toISOString();
      return transaction(() => {
        if (db.prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running')").get(projectId)) throw busyProject();
        return publishQueuedJob(db.prepare('INSERT INTO jobs(id,owner_id,project_id,type,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?) RETURNING *').get(randomUUID(), ownerId, projectId, type, JSON.stringify(payload), now, now));
      });
    },
    async getJob(ownerId, id) { return toJob(db.prepare('SELECT * FROM jobs WHERE owner_id=? AND id=?').get(identity(ownerId), identity(id))); },
    async claimJob(workerId) {
      identity(workerId);
      return transaction(() => {
        const now = Date.now();
        const owned = db.prepare("SELECT * FROM jobs WHERE status='running' AND worker_id=? AND lease_until>? ORDER BY created_at,id LIMIT 1").get(workerId, now);
        if (owned) return toJob(owned);
        const exhausted = db.prepare("UPDATE jobs SET status='error',stage='error',error='Задача прервана после трёх попыток. Повторите запуск.',worker_id=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND lease_until<=? AND attempts>=3 RETURNING *").all(new Date().toISOString(), now);
        for (const job of exhausted) {
          const row = get(job.owner_id, job.project_id);
          if (!row) continue;
          const project = decode(row.payload);
          if (project.jobId !== job.id) continue;
          Object.assign(project, { status: 'FAILED', error: job.error, updatedAt: job.updated_at });
          db.prepare('UPDATE projects SET payload=? WHERE id=? AND owner_id=?').run(JSON.stringify(project), job.project_id, job.owner_id);
        }
        db.prepare("UPDATE jobs SET status='queued',worker_id=NULL,lease_until=NULL WHERE status='running' AND lease_until<=?").run(now);
        const next = db.prepare(`SELECT id FROM jobs j WHERE status='queued' AND NOT EXISTS (
          SELECT 1 FROM jobs active WHERE active.project_id=j.project_id AND active.status='running') ORDER BY created_at,rowid LIMIT 1`).get();
        if (!next) return null;
        return toJob(db.prepare("UPDATE jobs SET status='running',stage='starting',progress=NULL,attempts=attempts+1,error=NULL,worker_id=?,lease_until=?,updated_at=? WHERE id=? RETURNING *").get(workerId, now + leaseMs, new Date().toISOString(), next.id));
      });
    },
    async heartbeat(jobId, workerId, { stage, progress } = {}) {
      return leaseUpdate(jobId, workerId, 'UPDATE jobs SET stage=COALESCE(?,stage),progress=?,lease_until=?,updated_at=?', [stage == null ? null : String(stage).slice(0, 120), progressValue(progress), Date.now() + leaseMs, new Date().toISOString()]);
    },
    async finishJob(jobId, workerId, { error, result } = {}) {
      return leaseUpdate(jobId, workerId, 'UPDATE jobs SET status=?,stage=?,progress=?,error=?,result=?,worker_id=NULL,lease_until=NULL,updated_at=?', [error ? 'error' : 'done', error ? 'error' : 'done', error ? null : 100, error ? String(error).slice(0, 1000) : null, result == null ? null : JSON.stringify(result), new Date().toISOString()]);
    },
    async retryJob(ownerId, id) {
      return transaction(() => {
        const failed = db.prepare("SELECT project_id FROM jobs WHERE owner_id=? AND id=? AND status='error'").get(identity(ownerId), identity(id));
        if (!failed) throw new Error('Failed job not found');
        if (db.prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running')").get(failed.project_id)) throw busyProject();
        return publishQueuedJob(db.prepare("UPDATE jobs SET status='queued',stage='queued',progress=NULL,error=NULL,result=NULL,worker_id=NULL,lease_until=NULL,updated_at=? WHERE id=? RETURNING *").get(new Date().toISOString(), id));
      });
    },
    async close() { if (!closed) { db.close(); closed = true; } },
  };
}

function supabaseStore(env) {
  let base;
  try { base = new URL(env.SUPABASE_URL); } catch { throw new Error('Invalid Supabase configuration'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !env.SUPABASE_SECRET_KEY) throw new Error('Invalid Supabase configuration');
  const request = async (endpoint, body) => {
    let response;
    try {
      response = await fetch(new URL(`/rest/v1/${endpoint}`, base), {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { apikey: env.SUPABASE_SECRET_KEY, ...(env.SUPABASE_SECRET_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
      });
    } catch { throw Object.assign(new Error('Video database is unavailable'), { status: 503, code: 'VIDEO_DATABASE_UNAVAILABLE' }); }
    if (response.status === 409) throw busyProject();
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const missingUsage = ['PGRST205', '42P01'].includes(body?.code);
      throw Object.assign(new Error(`Video database request failed (${response.status}); check server migration and credentials`), { status: response.status, ...(missingUsage ? { code: 'VIDEO_TABLE_MISSING' } : {}) });
    }
    try { return response.status === 204 ? null : await response.json(); }
    catch { throw new Error('Invalid video database response'); }
  };
  const query = (table, values) => `${table}?${new URLSearchParams(values)}`;
  const rpcJob = async (name, body) => { const rows = await request(`rpc/scenza_video_${name}`, body); return toJob(Array.isArray(rows) ? rows[0] : rows); };
  const checkedJob = async (name, body, message) => { const job = await rpcJob(name, body); if (!job) throw new Error(message); return job; };
  const allRows = async (table, select) => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request(query(table, { select, order: 'id.asc', limit: '500', offset: String(offset) }));
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  };
  return {
    async adminSnapshot() {
      let usageUnavailable = false;
      const [projects, jobs, usage] = await Promise.all([allRows('scenza_video_projects', 'id,payload'), allRows('scenza_video_jobs', '*'), allRows('scenza_ai_usage', 'id,payload').catch(error => { if (error.code !== 'VIDEO_TABLE_MISSING') throw error; usageUnavailable = true; return []; })]);
      return { projects: projects.map(row => adminProject(row.payload)), jobs: jobs.map(adminJob), usage: usage.map(row => row.payload), usageUnavailable };
    },
    async recordAiUsage(value) { const record = usageValue(value); await request('rpc/scenza_video_record_usage', { p_id: record.id, p_payload: record }); },
    async ownerMonthlyUsage(ownerId, month) {
      month = usageMonth(month);
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const page = await request(query('scenza_ai_usage', { select: 'id,payload', 'payload->>ownerId': `eq.${identity(ownerId)}`, 'payload->>createdAt': `like.${month}-*`, order: 'id.asc', limit: '500', offset: String(offset) }));
        rows.push(...page.map(row => row.payload));
        if (page.length < 500) return monthlyUsage(rows, month);
      }
    },
    async adminJobAction(id, action) {
      if (!['retry', 'cancel', 'delete'].includes(action)) throw new Error('Invalid job action');
      const rows = await request('rpc/scenza_video_admin_job', { p_id: identity(id), p_action: action });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async listProjects(ownerId) { return (await request(query('scenza_video_projects', { owner_id: `eq.${identity(ownerId)}`, select: 'payload', order: 'created_at.desc' }))).map(row => row.payload); },
    async getProject(ownerId, id) { const rows = await request(query('scenza_video_projects', { owner_id: `eq.${identity(ownerId)}`, id: `eq.${identity(id)}`, select: 'payload' })); return rows[0]?.payload || null; },
    async saveProject(ownerId, project) { const value = projectValue(ownerId, project); const rows = await request('rpc/scenza_video_save_project', { p_owner: ownerId, p_id: value.id, p_payload: value }); if (!rows?.length) throw new Error('Project owner access denied'); return rows[0].payload; },
    async enqueue(ownerId, projectId, type, payload = {}) { if (!jobTypes.has(type)) throw new Error('Invalid job type'); return checkedJob('enqueue', { p_owner: identity(ownerId), p_project: identity(projectId), p_type: type, p_payload: payload }, 'Project not found'); },
    async getJob(ownerId, id) { const rows = await request(query('scenza_video_jobs', { owner_id: `eq.${identity(ownerId)}`, id: `eq.${identity(id)}`, select: '*' })); return toJob(rows[0]); },
    async claimJob(workerId) { return rpcJob('claim', { p_worker: identity(workerId) }); },
    async heartbeat(jobId, workerId, { stage, progress } = {}) { return checkedJob('heartbeat', { p_id: identity(jobId), p_worker: identity(workerId), p_stage: stage == null ? null : String(stage).slice(0, 120), p_progress: progressValue(progress) }, 'Job lease lost'); },
    async finishJob(jobId, workerId, { error, result } = {}) { return checkedJob('finish', { p_id: identity(jobId), p_worker: identity(workerId), p_error: error ? String(error).slice(0, 1000) : null, p_result: result ?? null }, 'Job lease lost'); },
    async retryJob(ownerId, id) { return checkedJob('retry', { p_owner: identity(ownerId), p_id: identity(id) }, 'Failed job not found'); },
    async close() {},
  };
}
