import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../server/ai/store.mjs';
import { OpenRouterProvider } from '../server/ai/openai.mjs';
import { normalizeSettings } from '../server/ai/render.mjs';

test('provider records usage for each real request including errors and missing usage', async () => {
  const usage = [];
  const ai = new OpenRouterProvider({ apiKey: 'secret', onUsage: row => usage.push(row), fetcher: async () => Response.json({ id: 'req-usage', usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, cost: 0.002 }, choices: [{ finish_reason: 'stop', message: { content: '{"patch":{"muted":true}}' } }] }) });
  await ai.interpretEditRequest({ request: 'Mute', settings: normalizeSettings({}, 60), duration: 60 });
  assert.equal(usage.length, 1);
  assert.equal(usage[0].totalTokens, 105);
  assert.equal(usage[0].cost, 0.002);
  const unavailable = new OpenRouterProvider({ apiKey: 'secret', onUsage: row => usage.push(row), fetcher: async () => new Response('', { status: 402 }) });
  await assert.rejects(() => unavailable.interpretEditRequest({ request: 'Mute', settings: normalizeSettings({}, 60), duration: 60 }));
  assert.equal(usage.length, 2);
  assert.equal(usage[1].error, 'AI_PROVIDER_ERROR');
  assert.equal(usage[1].cost, null);
  assert.ok(!JSON.stringify(usage).includes('secret'));
});

test('unavailable usage accounting cannot fail a successful AI request or mask an API failure', async () => {
  const warnings = [];
  const options = { apiKey: 'secret', onUsage: async () => { throw new Error('private accounting credentials'); }, onUsageError: () => warnings.push('usage unavailable') };
  const ai = new OpenRouterProvider({ ...options, fetcher: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"patch":{"muted":true}}' } }] }) });
  assert.deepEqual(await ai.interpretEditRequest({ request: 'Mute', settings: normalizeSettings({}, 60), duration: 60 }), { muted: true });
  assert.equal(warnings.length, 1);
  const failed = new OpenRouterProvider({ ...options, fetcher: async () => new Response('', { status: 402 }) });
  await assert.rejects(() => failed.interpretEditRequest({ request: 'Mute', settings: normalizeSettings({}, 60), duration: 60 }), { code: 'AI_PROVIDER_ERROR' });
});

test('Supabase admin data survives a missing usage migration but does not hide other DB errors', async t => {
  const store = await createStore({ dataDir: 'unused', env: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_private' } });
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('scenza_ai_usage') ? Response.json({ code: 'PGRST205', message: 'missing relation secret' }, { status: 404 }) : Response.json([]));
  const snapshot = await store.adminSnapshot();
  assert.equal(snapshot.usageUnavailable, true);
  assert.deepEqual(snapshot.usage, []);
  assert.deepEqual(snapshot.jobs, []);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'PGRST301' }, { status: 401 }));
  await assert.rejects(() => store.adminSnapshot(), { status: 401 });
});

test('admin job operations reject live leases, fence expired workers and hide user media', async () => {
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/admin-store-'));
  const store = await createStore({ dataDir, env: {} });
  try {
    assert.equal(typeof store.adminSnapshot, 'function');
    await store.saveProject('alice', { id: 'p1', files: { private: 'secret.mp4' }, candidates: [{ id: 'clip', ready: true, createdAt: new Date().toISOString() }] });
    const job = await store.enqueue('alice', 'p1', 'analyze', { request: 'private user text' });
    await store.claimJob('worker');
    for (const action of ['retry', 'cancel', 'delete']) await assert.rejects(() => store.adminJobAction(job.id, action), error => error.status === 409);
    const raw = new DatabaseSync(path.join(dataDir, 'video-jobs.sqlite'));
    raw.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(job.id); raw.close();
    const snapshot = await store.adminSnapshot();
    assert.equal(snapshot.jobs[0].stalled, true);
    assert.equal(snapshot.projects[0].clips.length, 1);
    assert.ok(!JSON.stringify(snapshot).includes('secret.mp4'));
    assert.ok(!JSON.stringify(snapshot).includes('private user text'));
    await store.adminJobAction(job.id, 'cancel');
    await assert.rejects(() => store.finishJob(job.id, 'worker', { result: {} }), /lease/i);
    assert.equal((await store.getProject('alice', 'p1')).status, 'FAILED');
    await store.adminJobAction(job.id, 'retry');
    assert.equal((await store.getJob('alice', job.id)).status, 'queued');
    await store.claimJob('new-worker');
    await store.finishJob(job.id, 'new-worker', { error: 'API unavailable' });
    await store.adminJobAction(job.id, 'delete');
    assert.equal(await store.getJob('alice', job.id), null);
    assert.ok(await store.getProject('alice', 'p1'), 'deleting a task keeps the user project and files');
  } finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('AI usage ledger keeps provider-reported tokens and cost without inventing missing values', async () => {
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/admin-usage-'));
  const store = await createStore({ dataDir, env: {} });
  try {
    assert.equal(typeof store.recordAiUsage, 'function');
    await store.recordAiUsage({ id: 'request-1', ownerId: 'alice', projectId: 'p1', jobId: 'j1', model: 'google/gemini-2.5-flash-lite', inputTokens: 100, outputTokens: 20, totalTokens: 120, cost: 0.001 });
    await store.recordAiUsage({ id: 'request-1', ownerId: 'alice', projectId: 'p1', jobId: 'j1', model: 'google/gemini-2.5-flash-lite', totalTokens: 120 });
    await store.recordAiUsage({ id: 'request-2', ownerId: 'alice', projectId: 'p1', jobId: 'j1', model: 'google/gemini-2.5-flash-lite', error: 'AI_NETWORK_ERROR' });
    const rows = (await store.adminSnapshot()).usage;
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.id === 'request-1').totalTokens, 120);
    assert.equal(rows.find(row => row.id === 'request-2').totalTokens, null);
    assert.equal(rows.find(row => row.id === 'request-2').cost, null);
  } finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});
