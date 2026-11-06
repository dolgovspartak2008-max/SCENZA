import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fetchWithRetry, classifyNetworkError } from '../server/net.mjs';
import { createAdminService } from '../server/admin.mjs';
import { createStore } from '../server/ai/store.mjs';
import { createWorker, gracefulStop } from '../server/ai/worker.mjs';
import { planRestart, deployRestart, workerModules } from '../scripts/deploy-restart.mjs';

const net = { delays: [0, 0] };
const networkError = code => Object.assign(new TypeError('fetch failed https://secret.example/?key=private-value'), { cause: Object.assign(new Error(`getaddrinfo ${code} private-value`), { code }) });
const timeoutError = () => Object.assign(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

test('a failed first request that succeeds on retry is not an error', async () => {
  let calls = 0;
  const response = await fetchWithRetry(async () => { if (++calls === 1) throw networkError('ECONNRESET'); return new Response('{}'); }, 'https://x.test', {}, net);
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('timeout, DNS, TLS and reset are classified separately; secrets are not copied', async () => {
  assert.equal(classifyNetworkError(timeoutError()).kind, 'timeout');
  assert.equal(classifyNetworkError(networkError('ENOTFOUND')).kind, 'dns');
  assert.equal(classifyNetworkError(networkError('EAI_AGAIN')).kind, 'dns');
  assert.equal(classifyNetworkError(networkError('ECONNRESET')).kind, 'reset');
  assert.equal(classifyNetworkError(networkError('UNABLE_TO_VERIFY_LEAF_SIGNATURE')).kind, 'tls');
  assert.equal(classifyNetworkError(networkError('ECONNREFUSED')).kind, 'refused');
  let calls = 0;
  const error = await fetchWithRetry(async () => { calls++; throw timeoutError(); }, 'https://x.test', {}, net).catch(value => value);
  assert.equal(calls, 3);
  assert.deepEqual(error.network, { kind: 'timeout', code: 'TimeoutError', attempts: 3 });
  assert.ok(!JSON.stringify(error).includes('private-value') && !error.message.includes('private-value'));
});

test('HTTP 401/402/403/429 are returned at once; 5xx is retried', async () => {
  for (const status of [401, 402, 403, 429]) {
    let calls = 0;
    const response = await fetchWithRetry(async () => { calls++; return new Response('', { status }); }, 'https://x.test', {}, net);
    assert.equal(response.status, status); assert.equal(calls, 1);
  }
  let calls = 0;
  assert.equal((await fetchWithRetry(async () => new Response('', { status: ++calls < 3 ? 503 : 200 }), 'https://x.test', {}, net)).status, 200);
});

async function admin(t, { fetch, store }) {
  await mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/reliability-admin-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const auth = { bots: { adminRole: async () => 'owner' } };
  return createAdminService({ dataDir, auth, net, env: { OPENROUTER_API_KEY: 'private-key' }, fetch, getVideoApi: async () => ({ store }) });
}
const emptyStore = { alertSnapshot: async () => ({ jobs: [], usage: [] }) };

test('OpenRouter: brief failure gives no alert, a confirmed outage gives one informative alert, HTTP codes stay distinct', async t => {
  let calls = 0;
  const blip = await admin(t, { store: emptyStore, fetch: async () => { if (++calls === 1) throw timeoutError(); return Response.json({ data: { limit: null, limit_remaining: null } }); } });
  assert.deepEqual((await blip.alerts('owner')).filter(alert => alert.key.startsWith('ai:key')), []);
  const down = await admin(t, { store: emptyStore, fetch: async () => { throw networkError('ENOTFOUND'); } });
  const alerts = (await down.alerts('owner')).filter(alert => alert.key.startsWith('ai:key'));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, 'ai:key:unavailable:dns');
  assert.match(alerts[0].text, /3 попыток: не удалось найти адрес \(DNS\) \(ENOTFOUND\)/);
  assert.ok(!alerts[0].text.includes('private'));
  const keys = {};
  for (const status of [401, 402, 403, 429, 503]) {
    const service = await admin(t, { store: emptyStore, fetch: async () => new Response('', { status }) });
    keys[status] = (await service.alerts('owner')).find(alert => alert.key.startsWith('ai:key'))?.key;
  }
  assert.deepEqual(keys, { 401: 'ai:key:disabled', 402: 'ai:key:payment_required', 403: 'ai:key:disabled', 429: 'ai:key:rate_limited', 503: 'ai:key:http:503' });
});

test('Supabase: a 5-second blip is absorbed; a confirmed outage names the real category, not a sleeping project', async t => {
  const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_private-test-value' };
  const okKey = async () => Response.json({ data: { limit: null, limit_remaining: null } });
  let failures = 1;
  const flaky = await createStore({ dataDir: 'unused', env, net: { ...net, fetch: async () => { if (failures-- > 0) throw networkError('ECONNRESET'); return Response.json([]); } } });
  const ok = await admin(t, { store: flaky, fetch: okKey });
  assert.deepEqual((await ok.alerts('owner')).filter(alert => alert.key.startsWith('database')), []);
  for (const [code, kind, text] of [['ENOTFOUND', 'dns', /DNS/], ['ETIMEDOUT', 'timeout', /тайм-аут/]]) {
    const broken = await createStore({ dataDir: 'unused', env, net: { ...net, fetch: async () => { throw networkError(code); } } });
    const alerts = (await (await admin(t, { store: broken, fetch: okKey })).alerts('owner')).filter(alert => alert.key.startsWith('database'));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].key, `database:unavailable:VIDEO_DATABASE_UNAVAILABLE:${kind}`);
    assert.match(alerts[0].text, text);
    assert.doesNotMatch(alerts[0].text, /приостановлен|засыпают/);
    assert.ok(!alerts[0].text.includes('private-test-value'));
  }
  const denied = await createStore({ dataDir: 'unused', env, net: { ...net, fetch: async () => new Response('{}', { status: 401 }) } });
  assert.match((await (await admin(t, { store: denied, fetch: okKey })).alerts('owner')).find(alert => alert.key.startsWith('database')).text, /HTTP 401\/403/);
});

async function workerFixture(t, provider) {
  const root = path.resolve('.scena/reliability-tests'); await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'worker-'));
  const store = await createStore({ dataDir: path.join(dataDir, 'ai'), env: {} });
  const jobs = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID(), settings = { start: 0, end: 10 };
    await store.saveProject('local', { id, status: 'AWAITING_APPROVAL', duration: 20, files: {}, analysis: { segments: [] }, candidates: [], versions: [{ id: 'v1', settings }], currentVersion: 'v1', settings });
    jobs.push(await store.enqueue('local', id, 'revise', { request: 'Сделай короче', settings }));
  }
  const worker = await createWorker({ dataDir, env: {}, provider });
  t.after(async () => { await worker.close(); await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { store, worker, jobs };
}
const until = async check => { for (let i = 0; i < 500 && !await check(); i++) await new Promise(resolve => setTimeout(resolve, 10)); };

test('stopping during an active job finishes it, claims no second job and closes the store only afterwards', async t => {
  let started, finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const { store, worker, jobs } = await workerFixture(t, { interpretEditRequest: async () => { started = true; await gate; throw Object.assign(new Error('Правка не распознана.'), { status: 400 }); } });
  const running = worker.start();
  await until(() => started);
  gracefulStop(worker, { drainMs: 60000, log: () => {} })();
  finish();
  await running;
  assert.equal((await store.getJob('local', jobs[0].id)).status, 'error', 'current job finished through the store');
  assert.equal((await store.getJob('local', jobs[1].id)).status, 'queued', 'no second job was taken');
});

test('drain deadline aborts the job and returns it to the queue without an extra attempt or FAILED', async t => {
  const { store, worker, jobs } = await workerFixture(t, { interpretEditRequest: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  const running = worker.start();
  await until(() => worker.busy);
  gracefulStop(worker, { drainMs: 20, graceMs: 60000, log: () => {}, exit: () => assert.fail('job reacted to abort; no forced exit') })();
  await running;
  const job = await store.getJob('local', jobs[0].id), project = await store.getProject('local', job.projectId);
  assert.equal(job.status, 'queued'); assert.equal(job.attempts, 0);
  assert.notEqual(project.status, 'FAILED');
  assert.equal((await store.getJob('local', jobs[1].id)).status, 'queued');
});

test('a job that ignores the abort is released before the forced exit', async t => {
  let release;
  const hung = new Promise(resolve => { release = resolve; });
  const { store, worker, jobs } = await workerFixture(t, { interpretEditRequest: async () => { await hung; throw new Error('late'); } });
  const running = worker.start();
  await until(() => worker.busy);
  let exitCode;
  gracefulStop(worker, { drainMs: 10, graceMs: 20, log: () => {}, exit: code => { exitCode = code; } })();
  await until(() => exitCode !== undefined);
  assert.equal(exitCode, 0);
  const job = await store.getJob('local', jobs[0].id);
  assert.equal(job.status, 'queued'); assert.equal(job.attempts, 0);
  release(); await running;
});

test('deploy: auth-only change restarts the API only; worker change restarts the worker without blocking', async t => {
  const modules = await workerModules('.');
  assert.ok(modules.has('server/net.mjs'), 'worker import graph includes shared modules');
  const auth = planRestart({ changed: ['server/auth.mjs', 'src/landing/AuthModal.tsx'], modules });
  assert.deepEqual(auth.steps, [['restart', 'scenza']]);
  assert.deepEqual(planRestart({ changed: ['server/net.mjs'], modules }).steps, [['restart', 'scenza'], ['graceful-restart', 'scenza-worker']]);
  assert.deepEqual(planRestart({ changed: [], modules, envChanged: true }).steps, [['graceful-restart', 'scenza-worker']]);

  await mkdir(path.resolve('tmp'), { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/reliability-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const [previous, next] = [path.join(root, 'old'), path.join(root, 'new')];
  for (const dir of [previous, next]) for (const folder of ['server', 'deploy', 'scripts']) await cp(folder, path.join(dir, folder), { recursive: true });
  const env = path.join(root, 'ai.env'), state = path.join(root, 'state');
  await writeFile(env, 'OPENROUTER_API_KEY=private-one\nSCENA_BOT_TOKEN=x\n');
  const run = async (...command) => { calls.push(command.flat().join(' ')); };
  let calls = [];
  await writeFile(path.join(next, 'server/auth.mjs'), '// auth change\n');
  await deployRestart({ previous, next, envFiles: [env], stateFile: state, run, log: () => {} });
  assert.deepEqual(calls, ['systemctl restart scenza']);
  calls = [];
  await writeFile(env, 'OPENROUTER_API_KEY=private-one\nSCENA_BOT_TOKEN=changed\n');
  await deployRestart({ previous, next, envFiles: [env], stateFile: state, run, log: () => {} });
  assert.deepEqual(calls, ['systemctl restart scenza'], 'non-AI variables do not touch the worker');
  calls = [];
  await writeFile(path.join(next, 'server/ai/worker.mjs'), '// worker change\n');
  await deployRestart({ previous, next, envFiles: [env], stateFile: state, run, log: () => {} });
  assert.deepEqual(calls, ['systemctl restart scenza', 'systemctl restart --no-block scenza-worker']);
  calls = [];
  await writeFile(env, 'OPENROUTER_API_KEY=private-two\nSCENA_BOT_TOKEN=changed\n');
  const logs = [];
  await deployRestart({ previous: next, next, envFiles: [env], stateFile: state, run, log: line => logs.push(line) });
  assert.deepEqual(calls, ['systemctl restart --no-block scenza-worker'], 'AI key change restarts only the worker');
  assert.ok(!logs.join('\n').includes('private-two'));
});
