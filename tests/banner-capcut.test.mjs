import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createVideoApi, projectNumbers } from '../server/ai/api.mjs';
import { createWorker, capcutGuide } from '../server/ai/worker.mjs';
import { ff, inspect, normalizeSettings, normalizeAd, applyAdPatch } from '../server/ai/render.mjs';

test('projects are numbered by creation order instead of file names', () => {
  const numbers = projectNumbers([
    { id: 'c', createdAt: '2026-03-01T00:00:00Z' }, { id: 'a', createdAt: '2026-01-01T00:00:00Z' }, { id: 'b', createdAt: '2026-02-01T00:00:00Z', number: 2 },
  ]);
  assert.deepEqual([numbers.get('a'), numbers.get('b'), numbers.get('c')], [1, 2, 3]);
});

test('banner placement validates offsets, fade and pause background; switching modes resets geometry', () => {
  const insert = normalizeAd({ position: 'insert', duration: 4 }, 20);
  assert.deepEqual([insert.start, insert.width, insert.background, insert.backgroundColor, insert.fit], [10, 100, 'color', '#000000', 'contain']);
  assert.throws(() => normalizeAd({ position: 'insert', offsetX: 80 }, 20), /сдвиг/);
  assert.throws(() => normalizeAd({ position: 'insert', duration: 1, fade: 1 }, 20), /появление/);
  assert.throws(() => normalizeAd({ position: 'insert', backgroundColor: 'red' }, 20), /фон/);
  assert.equal(normalizeAd({ fit: 'stretch' }, 20).fill, true);
  const overlay = applyAdPatch(insert, { position: 'bottom-right' }, 20);
  assert.deepEqual([overlay.width, overlay.height, overlay.duration, overlay.start], [45, 25, 5, 7.5]);
  assert.match(capcutGuide({ settings: { format: '9:16', start: 0, end: 20 }, ad: insert, subtitles: true, music: false }), /Разделить[\s\S]*4 сек/);
});

test('banner is editable during review and the CapCut pack contains a clean clip, subtitles and banner', async t => {
  await mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/banner-capcut-')), id = randomUUID(), owner = 'capcut-test';
  const api = await createVideoApi({ dataDir, env: {} });
  const server = createServer(async (request, response) => {
    try { await api.handle(request, response, owner); }
    catch (error) { response.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); }
  });
  const worker = await createWorker({ dataDir, env: {}, provider: {} });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await worker.close(); await api.close(); await rm(dataDir, { recursive: true, force: true }); });
  const objects = path.join(dataDir, 'ai/objects', id); await mkdir(objects, { recursive: true });
  const original = path.join(objects, 'original.mp4'), banner = path.join(dataDir, 'banner.png');
  await ff(['-f', 'lavfi', '-i', 'color=blue:s=320x180:r=10:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', original]);
  await ff(['-f', 'lavfi', '-i', 'color=red:s=200x100', '-frames:v', '1', banner]);
  const settings = normalizeSettings({ start: 0, end: 6, subtitles: true, format: '9:16' }, 6);
  await api.store.saveProject(owner, { id, createdAt: new Date().toISOString(), title: 'VID_1090271752832399850.mov', upload: { name: 'VID_1090271752832399850.mov', size: 1, bytes: 1 }, status: 'AWAITING_APPROVAL', duration: 6, settings, currentVersion: 'v1', candidates: [{ id: randomUUID(), start: 0, end: 6, ready: true, settings }], versions: [{ id: 'v1', number: 1, settings, ad: null }], files: { original: { key: `${id}/original.mp4`, mime: 'video/mp4' } }, analysis: { hasAudio: false, segments: [{ start: 1, end: 3, text: 'Привет, мир' }], tracking: [] }, music: [] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, route = `/api/video/projects/${id}`;
  const request = async (endpoint, method = 'GET', body) => {
    const response = await fetch(base + endpoint, { method, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  };
  const complete = async job => { await worker.once(); const result = await api.store.getJob(owner, job.id); assert.equal(result.status, 'done', JSON.stringify(result)); };

  let project = (await request(route)).project;
  assert.equal(project.title, 'Project 1');
  await complete((await request(`${route}/advertisement?filename=banner.png`, 'POST', await readFile(banner))).job);
  project = (await request(route)).project;
  assert.equal(project.status, 'AWAITING_APPROVAL', 'adding a banner must not approve the clip');
  assert.deepEqual([project.ad.position, project.ad.start, project.ad.background], ['insert', 3, 'color']);
  project = (await request(`${route}/advertisement`, 'PUT', { ...project.ad, start: 2, duration: 2, offsetY: -10, fade: .5, backgroundColor: '#112233' })).project;
  assert.deepEqual([project.status, project.ad.start, project.ad.offsetY, project.ad.backgroundColor], ['AWAITING_APPROVAL', 2, -10, '#112233']);

  await complete((await request(`${route}/capcut`, 'POST', {})).job);
  project = (await request(route)).project;
  assert.equal(project.status, 'AWAITING_APPROVAL');
  const pack = project.capcutPacks.current, entry = project.files[pack.fileId];
  assert.equal(entry.filename, 'project-1-capcut.zip');
  const response = await fetch(`${base}${route}/files/${pack.fileId}`);
  assert.match(response.headers.get('content-disposition'), /project-1-capcut\.zip/);
  const archive = path.join(dataDir, 'pack.zip'), unpacked = path.join(dataDir, 'unpacked');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;z.extractall(sys.argv[2])', archive, unpacked]);
  const clip = await inspect(path.join(unpacked, '1-video.mp4'));
  assert.deepEqual([clip.width, clip.height], [1080, 1920]); assert.ok(Math.abs(clip.duration - 6) < .2, 'the clean clip has no banner pause');
  assert.match(await readFile(path.join(unpacked, '2-subtitles.srt'), 'utf8'), /00:00:01,000 --> 00:00:03,000\nПривет, мир/);
  assert.ok((await readFile(path.join(unpacked, '3-banner.png'))).length > 0);
  assert.match(await readFile(path.join(unpacked, 'CapCut - instrukciya.txt'), 'utf8'), /2 сек[\s\S]*Premiere Pro/);
  // The editing timeline must be well-formed XML that pauses the clip for the banner, relinked by file name.
  const xml = await readFile(path.join(unpacked, '5-premiere-davinci.xml'), 'utf8');
  execFileSync('python3', ['-c', 'import sys,xml.dom.minidom as m;m.parse(sys.argv[1])', path.join(unpacked, '5-premiere-davinci.xml')]);
  assert.match(xml, /<pathurl>1-video\.mp4<\/pathurl>/);
  assert.match(xml, /<clipitem id="banner-1"><name>3-banner\.png<\/name>/);
  assert.equal((xml.match(/<clipitem id="clip-/g) || []).length, 2, 'clip is split around the banner');

  project = (await request(`${route}/advertisement`, 'DELETE')).project;
  assert.equal(project.ad, null);
});
