import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../server/ai/store.mjs';
import { createWorker } from '../server/ai/worker.mjs';
import { ff, inspect } from '../server/ai/render.mjs';

async function fixture(t, provider) {
  const root = path.resolve('tmp'); await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'ai-cache-'));
  const store = await createStore({ dataDir: path.join(dataDir, 'ai'), env: {} });
  const worker = await createWorker({ dataDir, env: {}, provider });
  t.after(async () => { await worker.close(); await store.close(); assert.ok(dataDir.startsWith(root + path.sep)); await rm(dataDir, { recursive: true, force: true }); });
  await mkdir(path.join(dataDir, 'ai/objects/project'), { recursive: true });
  await writeFile(path.join(dataDir, 'ai/objects/project/proxy.mp4'), 'provider fixture');
  await store.saveProject('owner', { id: 'project', duration: 90, hasAudio: true, analysis: { segments: [], scenes: [] }, candidates: [], versions: [], settings: { start: 0, end: 60 }, files: { original: { key: 'project/original.mp4' }, proxy: { key: 'project/proxy.mp4' } } });
  return { store, worker, dataDir };
}

test('empty analysis is a completed paid result and survives retries and new jobs', async t => {
  let calls = 0;
  const { store, worker } = await fixture(t, { analyzeVideo: async () => { calls++; return { candidates: [], model: 'video-model' }; } });
  const job = await store.enqueue('owner', 'project', 'analyze'); await worker.once();
  await store.retryJob('owner', job.id); await worker.once();
  await store.enqueue('owner', 'project', 'analyze'); await worker.once();
  assert.equal(calls, 1);
  const project = await store.getProject('owner', 'project');
  assert.deepEqual(project.analysisResult.candidates, []);
  assert.equal(project.analysisResult.model, 'video-model');
  assert.equal((await store.ownerMonthlyUsage('owner')).sourceMinutes, 1.5);
  project.analysisCache.version = -1; await store.saveProject('owner', project);
  await store.enqueue('owner', 'project', 'analyze'); await worker.once();
  assert.equal(calls, 2, 'incompatible cache versions must trigger fresh selection');
});

test('failed rendering retries reuse the interpreted edit instead of paying again', async t => {
  let edits = 0;
  const { store, worker } = await fixture(t, { interpretEditRequest: async () => { edits++; return { subtitles: false }; } });
  const job = await store.enqueue('owner', 'project', 'revise', { request: 'Убери субтитры' }); await worker.once();
  await store.retryJob('owner', job.id); await worker.once();
  assert.equal(edits, 1);
  const usage = await store.ownerMonthlyUsage('owner');
  assert.equal(usage.editRequests, 1);
});

test('a persisted rendered revision completes its interrupted job without repeating the model or render', async t => {
  let edits = 0;
  const { store, worker } = await fixture(t, { interpretEditRequest: async () => { edits++; throw new Error('must not call'); } });
  const job = await store.enqueue('owner', 'project', 'revise', { request: 'Убери субтитры' });
  const project = await store.getProject('owner', 'project');
  project.currentVersion = 'completed-version';
  project.versions = [{ id: 'completed-version', jobId: job.id, settings: project.settings }];
  project.files['completed-version'] = { key: 'project/completed-version.mp4' };
  await store.saveProject('owner', project); await worker.once();
  assert.equal((await store.getJob('owner', job.id)).status, 'done');
  assert.equal(edits, 0);
  assert.equal((await store.getProject('owner', 'project')).status, 'AWAITING_APPROVAL');
});

test('owner monthly ledger deduplicates source minutes and preserves unknown provider costs', async t => {
  const { store } = await fixture(t, {});
  const base = { ownerId: 'owner', projectId: 'project', jobId: 'job' };
  await store.recordAiUsage({ ...base, id: 'source', kind: 'source', sourceSeconds: 125 });
  await store.recordAiUsage({ ...base, id: 'source', kind: 'source', sourceSeconds: 125 });
  await store.recordAiUsage({ ...base, kind: 'ai', operation: 'analyze', model: 'video', inputTokens: 100, outputTokens: 20, totalTokens: 120, cost: 0.12 });
  await store.recordAiUsage({ ...base, kind: 'ai', operation: 'revise', model: 'edit', inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  await store.recordAiUsage({ ...base, id: 'edit', kind: 'edit' });
  await store.recordAiUsage({ ...base, ownerId: 'someone-else', kind: 'source', sourceSeconds: 600 });
  const usage = await store.ownerMonthlyUsage('owner');
  assert.equal(usage.sourceMinutes, 125 / 60); assert.equal(usage.sourceCount, 1);
  assert.equal(usage.calls, 2); assert.equal(usage.editRequests, 1);
  assert.equal(usage.totalTokens, 132); assert.equal(usage.cost, 0.12); assert.equal(usage.unknownCostCalls, 1);
  assert.deepEqual(usage.models.map(model => model.model).sort(), ['edit', 'video']);
  assert.equal((await store.ownerMonthlyUsage('owner', '2020-01')).sourceMinutes, 0);
  await assert.rejects(() => store.ownerMonthlyUsage('owner', 'bad-month'));
  await store.recordAiUsage({ ...base, kind: 'source', sourceSeconds: 90, createdAt: '2020-01-15T00:00:00Z' });
  assert.equal((await store.ownerMonthlyUsage('owner', '2020-01')).sourceMinutes, 1.5);
  assert.equal((await store.ownerMonthlyUsage('owner')).sourceMinutes, 125 / 60);
});

test('failed analysis does not count the upload as processed source minutes', async t => {
  const { store, worker } = await fixture(t, { analyzeVideo: async () => { throw new Error('provider unavailable'); } });
  await store.enqueue('owner', 'project', 'analyze'); await worker.once();
  assert.equal((await store.ownerMonthlyUsage('owner')).sourceMinutes, 0);
});

test('a changed original invalidates cached transcript and scene selection', async t => {
  const { store, worker } = await fixture(t, { analyzeVideo: async () => ({ candidates: [], model: 'video-model' }) });
  await store.enqueue('owner', 'project', 'analyze'); await worker.once();
  const project = await store.getProject('owner', 'project');
  project.sourceFingerprint = 'different-source-content'; await store.saveProject('owner', project);
  await store.enqueue('owner', 'project', 'analyze'); await worker.once();
  const changed = await store.getProject('owner', 'project');
  assert.equal(changed.analysis, null); assert.equal(changed.analysisResult, null);
  assert.deepEqual(changed.analysisWindows, []); assert.deepEqual(changed.candidates, []);
});

test('Supabase owner usage filters records before pagination and preserves source duration', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const month = new Date().toISOString().slice(0, 7); let reads = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'POST') {
      const record = JSON.parse(options.body).p_payload;
      assert.equal(record.kind, 'source'); assert.equal(record.sourceSeconds, 90);
      return new Response(null, { status: 204 });
    }
    const params = new URL(url).searchParams;
    assert.equal(params.get('payload->>ownerId'), 'eq.owner');
    assert.equal(params.get('payload->>createdAt'), `like.${month}-*`);
    assert.equal(params.get('offset'), String(reads++ * 500));
    return Response.json(reads === 1 ? Array.from({ length: 500 }, (_, i) => ({ id: String(i), payload: { kind: 'source', sourceSeconds: 60, createdAt: `${month}-01T00:00:00Z` } })) : []);
  };
  const store = await createStore({ env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-secret-fixture' } });
  await store.recordAiUsage({ ownerId: 'owner', projectId: 'project', jobId: 'job', kind: 'source', sourceSeconds: 90 });
  const result = await store.ownerMonthlyUsage('owner');
  assert.equal(reads, 2); assert.equal(result.sourceMinutes, 500); assert.equal(result.calls, 0);
});

test('worker normalizes uploaded video advertisement and rejects media longer than thirty seconds', async t => {
  const { store, worker, dataDir } = await fixture(t, {});
  const uploads = path.join(dataDir, 'ai/uploads'); await mkdir(uploads, { recursive: true });
  await writeFile(path.join(dataDir, 'ai/objects/project/original.mp4'), 'unused original');
  for (const seconds of [2, 31]) {
    const localName = `ad-${seconds}.mp4`;
    await ff(['-f', 'lavfi', '-i', `testsrc2=s=160x90:r=1:d=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(uploads, localName)]);
    const job = await store.enqueue('owner', 'project', 'asset', { kind: 'ad', adKind: 'video', localName, assetId: `ad-${seconds}` });
    await worker.once();
    const result = await store.getJob('owner', job.id);
    assert.equal(result.status, seconds === 2 ? 'done' : 'error', result.error);
    if (seconds === 2) {
      const project = await store.getProject('owner', 'project');
      assert.equal(project.ad.kind, 'video'); assert.equal(project.ad.mediaDuration, 2);
      // A new banner pauses the clip in the middle and plays for its own length.
      assert.equal(project.ad.position, 'insert'); assert.equal(project.ad.start, 30); assert.equal(project.ad.duration, 2); assert.equal(project.ad.background, 'color');
      const metadata = await inspect(path.join(dataDir, 'ai/objects', project.files[project.ad.fileId].key));
      assert.equal(metadata.hasAudio, false); assert.equal(metadata.duration, 2);
    } else assert.match(result.error, /30 секунд/);
  }
});

test('shortening a clip adapts existing ad timing but rejects explicit invalid ad timing', async t => {
  let patch = { segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }] };
  const { store, worker, dataDir } = await fixture(t, { interpretEditRequest: async () => patch });
  const objects = path.join(dataDir, 'ai/objects/project');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=2:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(objects, 'original.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'color=green:s=120x40', '-frames:v', '1', path.join(objects, 'ad.png')]);
  for (const type of ['preview', 'revise', 'invalid']) {
    const project = await store.getProject('owner', 'project');
    project.settings = { start: 0, end: 80, subtitles: false };
    project.files.ad = { key: 'project/ad.png', mime: 'image/png' };
    project.ad = { fileId: 'ad', kind: 'image', start: 37.5, duration: 5, position: 'auto', width: 45, opacity: 1 };
    await store.saveProject('owner', project);
    if (type === 'invalid') patch = { end: 2, ad: { start: 3, duration: 1 } };
    const job = await store.enqueue('owner', 'project', type === 'preview' ? 'preview' : 'revise', type === 'preview' ? { settings: { start: 0, end: 2, subtitles: false } } : { request: 'Оставь только первые две секунды' });
    await worker.once();
    const result = await store.getJob('owner', job.id);
    assert.equal(result.status, type === 'invalid' ? 'error' : 'done', result.error);
    const updated = await store.getProject('owner', 'project');
    if (type !== 'invalid') {
      assert.equal(updated.ad.duration, 2); assert.equal(updated.ad.start, 0);
      assert.deepEqual(updated.versions.at(-1).ad, updated.ad);
    } else assert.equal(updated.ad.start, 37.5, 'an invalid edit must preserve the previous advertisement');
  }
});
