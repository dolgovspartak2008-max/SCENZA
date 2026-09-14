import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorker } from '../server/ai/worker.mjs';
import { createStore } from '../server/ai/store.mjs';
import { createVideoApi } from '../server/ai/api.mjs';
import { createServer } from '../server/index.mjs';
import { ff, inspect } from '../server/ai/render.mjs';

test('analysis produces downloadable vertical stories and editor preserves the montage', { timeout: 120000 }, async () => {
  const root = path.resolve('.scena/test-ai'); await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'stories-')), id = randomUUID();
  let store, worker, api, server;
  try {
    const objectRoot = path.join(dataDir, 'ai/objects', id); await mkdir(objectRoot, { recursive: true });
    const source = path.join(objectRoot, 'original.mp4');
    await ff(['-f','lavfi','-i','testsrc2=s=160x90:r=10:d=16','-f','lavfi','-i','sine=frequency=440:duration=16','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
    store = await createStore({ dataDir: path.join(dataDir, 'ai'), env: {} });
    const segments = [{ start: 10, end: 15 }, { start: 0, end: 5 }];
    const candidate = { id: randomUUID(), start: 0, end: 15, duration: 10, segments, keywords: ['Сюжет'], title: 'История', score: 80 };
    await store.saveProject('local', { id, title: 'Story test', status: 'READY', duration: 16, hasAudio: true, files: { original: { key: `${id}/original.mp4`, mime: 'video/mp4' } }, analysis: { hasAudio: true, tracking: [], segments: [{ start: 0, end: 2, text: 'Сюжет', words: [{ start: 0, end: 2, word: 'Сюжет' }] }] }, candidates: [candidate], versions: [], music: [] });
    const job = await store.enqueue('local', id, 'analyze');
    worker = await createWorker({ dataDir, env: {}, provider: {} }); await worker.once();
    assert.equal((await store.getJob('local', job.id)).status, 'done');
    const project = await store.getProject('local', id);
    const metadata = await inspect(path.join(dataDir, 'ai/objects', project.files[candidate.id].key));
    assert.deepEqual([metadata.width, metadata.height], [1080, 1920]);
    assert.ok(Math.abs(metadata.duration - 10) < .2, 'duration must be the sum of story parts');
    assert.equal(project.files[candidate.id].download, true);
    api = await createVideoApi({ dataDir, env: {} });
    assert.equal((await api.listClips('local')).length, 1, 'ready stories are available in the library');
    assert.deepEqual(await api.listClips('other-user'), []);
    server = await createServer({ dataDir, seed: false }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const banner = path.join(dataDir, 'banner.png');
    await ff(['-f','lavfi','-i','color=green:s=240x60','-frames:v','1',banner]);
    const uploaded = await fetch(`http://127.0.0.1:${server.address().port}/api/video/projects/${id}/advertisement?filename=banner.png`, { method: 'POST', body: await readFile(banner) });
    assert.equal(uploaded.status, 202, 'banner can be applied directly to ready stories');
    const bannerJob = (await uploaded.json()).job;
    await worker.once();
    assert.equal((await store.getJob('local', bannerJob.id)).status, 'done');
    const advertised = await store.getProject('local', id);
    assert.equal(advertised.status, 'READY');
    assert.equal(advertised.candidates[0].adFileId, advertised.ad.fileId);
    const refreshed = await fetch(`http://127.0.0.1:${server.address().port}/api/video/projects/${id}/files/${candidate.id}`, { method:'HEAD' });
    assert.match(refreshed.headers.get('cache-control'), /no-cache/, 'replaced banner renders must not reuse stale video');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/video/projects/${id}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sceneId: candidate.id, settings: { start: 0, end: 15, subtitleSize: 60 } }) });
    assert.equal(response.status, 202);
    const queued = await store.getJob('local', (await response.json()).job.id);
    assert.deepEqual(queued.payload.settings.segments, segments);
    assert.deepEqual(queued.payload.settings.keywords, ['Сюжет']);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await api?.close(); await worker?.close(); await store?.close();
    assert.ok(dataDir.startsWith(root + path.sep)); await rm(dataDir, { recursive: true, force: true });
  }
});
