import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from '../server/index.mjs';
import { createStore } from '../server/ai/store.mjs';
import { createWorker } from '../server/ai/worker.mjs';
import { estimateRates, templateSettings } from '../server/ai/api.mjs';
import { ff } from '../server/ai/render.mjs';

async function local(t) {
  const root = path.resolve('tmp'); await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'templates-'));
  const server = await createServer({ dataDir, seed: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, method = 'GET', body) => { const response = await fetch(base + route, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  return { dataDir, api };
}

test('templates keep only the reusable look, survive a restart and style a new project', async t => {
  const { dataDir, api } = await local(t);
  assert.deepEqual((await api('/api/video/templates')).body, { items: [], defaultId: null });
  const look = { format: '1:1', subtitleStyle: 'Bold', subtitleFont: 'rubik', subtitleSize: 70, subtitleColor: '#ffdf00', subtitleY: 70, start: 10, end: 40, keywords: ['победа'], musicId: 'track', subtitleReplacements: [{ from: 'a', to: 'b' }], subtitleColors: ['bad'] };
  const saved = await api('/api/video/templates', 'POST', { name: '  Подкаст  ', settings: look, default: true });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.template.name, 'Подкаст');
  assert.deepEqual(saved.body.template.settings, { format: '1:1', subtitleStyle: 'Bold', subtitleFont: 'rubik', subtitleSize: 70, subtitleColor: '#ffdf00', subtitleY: 70 });
  assert.deepEqual(saved.body.skipped, ['subtitleColors']);
  assert.equal(saved.body.defaultId, saved.body.template.id);
  assert.equal((await api('/api/video/templates', 'POST', { name: '', settings: look })).status, 400);
  const id = saved.body.template.id;
  const updated = await api(`/api/video/templates/${id}`, 'PUT', { settings: { ...look, subtitleSize: 80 } });
  assert.equal(updated.body.template.settings.subtitleSize, 80);
  // Default is applied when the upload does not choose; an explicit null opts out.
  const withDefault = await api('/api/video/projects', 'POST', { name: 'a.mp4', size: 10 });
  assert.deepEqual(withDefault.body.project.template, { id, name: 'Подкаст', settings: updated.body.template.settings });
  assert.equal((await api('/api/video/projects', 'POST', { name: 'b.mp4', size: 10, templateId: null })).body.project.template, undefined);
  assert.equal((await api('/api/video/projects', 'POST', { name: 'c.mp4', size: 10, templateId: 'missing' })).status, 404);
  assert.equal((await api(`/api/video/templates/${id}`, 'PUT', { default: false })).body.defaultId, null);
  // A fresh server reads the same file: templates belong to the account, not to the page.
  const again = await createServer({ dataDir, seed: false });
  await new Promise(resolve => again.listen(0, '127.0.0.1', resolve));
  try { assert.equal((await (await fetch(`http://127.0.0.1:${again.address().port}/api/video/templates`)).json()).items[0].settings.subtitleSize, 80); }
  finally { await new Promise(resolve => again.close(resolve)); }
  assert.equal((await api(`/api/video/templates/${id}`, 'DELETE')).body.items.length, 0);
  assert.equal((await api(`/api/video/templates/${id}`, 'DELETE')).status, 404);
  assert.deepEqual(templateSettings({ muted: 'yes', musicVolume: 2, cropMode: 'manual' }), { settings: { cropMode: 'manual' }, skipped: ['muted', 'musicVolume'] });
});

test('limits are published and checked before upload; estimates need real measured runs', async t => {
  const { dataDir, api } = await local(t);
  const { limits } = (await api('/api/video/config')).body;
  assert.deepEqual(limits, { maxBytes: 20 * 1024 ** 3, maxSeconds: 1200, maxSide: 8192, formats: ['mp4', 'mov', 'mkv', 'webm', 'm4v'], maxClipSeconds: 120, maxClips: 10 });
  assert.match((await api('/api/video/projects', 'POST', { name: 'long.mp4', size: 10, duration: 1201 })).body.error, /20 минут/);
  assert.match((await api('/api/video/projects', 'POST', { name: 'clip.avi', size: 10 })).body.error, /MP4, MOV, MKV, WebM/);
  assert.match((await api('/api/video/projects', 'POST', { name: 'big.mp4', size: 21 * 1024 ** 3 })).body.error, /20 ГБ/);
  assert.deepEqual((await api('/api/video/estimate')).body, { rates: {} });
  const store = await createStore({ dataDir: path.join(dataDir, 'ai'), env: {} });
  t.after(() => store.close());
  for (const [index, seconds] of [40, 60, 80, 100].entries()) await store.saveProject('local', { id: `p${index}`, status: 'READY', files: {}, candidates: [], versions: [], timings: { transcribe: { seconds, units: 200 } } });
  assert.deepEqual(estimateRates(await store.recentTimings()), { transcribe: { low: .3, high: .4, samples: 4 } });
  assert.deepEqual(estimateRates([{ render: { seconds: 5, units: 10 } }, { render: { seconds: 6, units: 10 } }]), {});
});

test('the worker refuses a source longer than the limit before any token is spent', { timeout: 120000 }, async t => {
  const root = path.resolve('tmp'); await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'limit-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createStore({ dataDir: path.join(dataDir, 'ai'), env: {} });
  const worker = await createWorker({ dataDir, env: {} });
  t.after(async () => { await worker.close(); await store.close(); });
  const input = path.join(dataDir, 'ai', 'uploads', 'long.original');
  await mkdir(path.dirname(input), { recursive: true });
  await ff(['-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=1', '-t', '1230', '-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'mp4', input], { timeout: 60000 });
  await store.saveProject('owner', { id: 'long', status: 'PREPROCESSING', upload: { name: 'long.mp4', size: 1, bytes: 1 }, files: {}, candidates: [], versions: [], music: [] });
  await store.enqueue('owner', 'long', 'preprocess');
  assert.equal(await worker.once(), true);
  const project = await store.getProject('owner', 'long');
  assert.equal(project.status, 'FAILED');
  assert.match(project.error, /длиннее 20 минут.*токены не списаны/);
  assert.deepEqual(await store.ownerTokens('owner'), []);
});
