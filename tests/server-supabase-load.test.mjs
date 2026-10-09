import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/ai/store.mjs';
import { createAdminService } from '../server/admin.mjs';
import { createWorker } from '../server/ai/worker.mjs';

const owner = { bots: { adminRole: async id => id === 'owner' ? 'owner' : null, adminSnapshot: async () => ({ users: [], events: [], promos: [], ownerTelegramId: 'owner' }) } };
const supabaseEnv = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_private' };

test('idle worker backs off to 30 s and claims again immediately after a job', { timeout: 10000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'scenza-idle-'));
  const sleeps = [];
  let worker;
  try {
    worker = await createWorker({ dataDir, env: {}, provider: {}, sleep: async ms => { sleeps.push(ms); if (sleeps.length >= 5) worker.stop(); } });
    // Empty x4, one job, empty again: the found job must not wait, and the next empty poll starts the backoff over.
    const claims = [false, false, false, false, true, false];
    let calls = 0;
    worker.once = async () => { calls++; return claims.shift() ?? false; };
    const safety = setTimeout(() => worker.stop(), 3000); safety.unref();
    await worker.start();
    clearTimeout(safety);
    assert.deepEqual(sleeps, [10000, 20000, 30000, 30000, 10000]);
    assert.equal(calls, 6, 'a found job is followed by the next claim without a pause');
  } finally { await worker?.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('Telegram alert check reads only failed/active job fields and fresh AI errors from Supabase', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'scenza-alerts-'));
  const recent = new Date(Date.now() - 60000).toISOString();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const target = new URL(url);
    requests.push({ table: target.pathname.split('/').pop(), params: Object.fromEntries(target.searchParams) });
    if (target.pathname.endsWith('scenza_video_projects')) return Response.json([{ id: 'p1', payload: { id: 'p1', ownerId: 'u1', analysis: { heavy: 'x'.repeat(1000) } } }]);
    if (target.pathname.endsWith('scenza_video_jobs')) return Response.json([{ id: 'j1', owner_id: 'u1', project_id: 'p1', type: 'analyze', status: 'error', stage: 'error', progress: null, attempts: 1, error: 'Обработка прервана. Проверьте настройки сервиса и повторите.', lease_until: null, created_at: recent, updated_at: recent }]);
    if (target.pathname.endsWith('scenza_ai_usage')) return Response.json([{ id: 'u1', payload: { id: 'u1', error: 'AI_RATE_LIMITED', createdAt: recent } }]);
    return Response.json([]);
  });
  try {
    const store = await createStore({ dataDir, env: supabaseEnv });
    const admin = await createAdminService({ auth: owner, dataDir, getVideoApi: async () => ({ store }), env: {} });
    const alerts = await admin.alerts('owner');
    assert.ok(alerts.some(alert => alert.key.startsWith('job:error:analyze:')), 'job error alert kept');
    assert.ok(alerts.some(alert => alert.key === 'ai:AI_RATE_LIMITED'), 'AI error alert kept');

    assert.equal(requests.filter(item => item.table === 'scenza_video_projects').length, 0, 'project payloads are not downloaded for alerts');
    const jobs = requests.filter(item => item.table === 'scenza_video_jobs');
    assert.equal(jobs.length, 1);
    assert.doesNotMatch(jobs[0].params.select, /\*|payload|result/, 'job payload/result columns are not selected');
    assert.match(jobs[0].params.or || '', /status\.eq\.error,updated_at\.gt\./, 'only fresh failed jobs are filtered server-side');
    assert.match(jobs[0].params.or || '', /status\.in\.\(queued,running\)/, 'active jobs are still checked for stalls');
    const usage = requests.filter(item => item.table === 'scenza_ai_usage');
    assert.equal(usage.length, 1);
    assert.equal(usage[0].params['payload->>error'], 'not.is.null');
    assert.match(usage[0].params['payload->>createdAt'] || '', /^gt\./, 'only fresh AI errors are read');
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('local alert snapshot matches the full snapshot for failed and active jobs', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'scenza-alerts-local-'));
  const store = await createStore({ dataDir, env: {} });
  try {
    for (const id of ['a', 'b', 'c']) await store.saveProject('u1', { id, status: 'UPLOADED', analysis: { heavy: true } });
    await store.enqueue('u1', 'a', 'analyze');
    const failed = await store.claimJob('w1'); await store.finishJob(failed.id, 'w1', { error: 'worker failed' });
    await store.enqueue('u1', 'b', 'preview');
    const done = await store.claimJob('w1'); await store.finishJob(done.id, 'w1', { result: { ok: true } });
    await store.enqueue('u1', 'c', 'export');
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const light = await store.alertSnapshot({ since });
    const full = await store.adminSnapshot();
    assert.equal(light.projects, undefined, 'no project payloads');
    const wanted = full.jobs.filter(job => job.status !== 'done');
    assert.deepEqual(light.jobs.map(job => job.id).sort(), wanted.map(job => job.id).sort());
    for (const job of light.jobs) { const { stalled, ...rest } = job; const match = full.jobs.find(item => item.id === job.id); assert.equal(stalled, match.stalled); assert.equal(rest.error, match.error); assert.equal(rest.status, match.status); assert.equal(rest.stage, match.stage); }
  } finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});
