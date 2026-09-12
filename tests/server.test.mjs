import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';

test('local video ingest, scenes, banner, export, persistence and security', { timeout: 120000 }, async t => {
  let backend;
  try { backend = await import('../server/index.mjs'); } catch { /* implementation is the first assertion */ }
  assert.equal(typeof backend?.createServer, 'function', 'local server must expose createServer');
  const { default: ffmpeg } = await import('ffmpeg-static');
  const root = await mkdtemp(path.resolve('tmp/server-test-'));
  let server;
  try {
    const input = path.join(root, 'source.mp4');
    const generated = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input], { windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr?.toString());
    server = await backend.createServer({ dataDir: path.join(root, 'data'), seed: false });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = async (url, options = {}) => { const response = await fetch(base + url, options); return { response, data: await response.json() }; };
    const wait = async (id, expected = 'done') => { for (let count = 0; count < 240; count++) { const { data } = await api(`/api/jobs/${id}`); if (['done', 'error', 'cancelled'].includes(data.job.status)) { assert.equal(data.job.status, expected, data.job.message); return data.job; } await new Promise(resolve => setTimeout(resolve, 200)); } assert.fail('job did not finish'); };
    assert.equal((await api('/api/health')).data.ok, true);
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) assert.equal(backend.isPublicAddress(address), false, address);
    assert.equal(backend.isPublicAddress('8.8.8.8'), true);
    assert.equal(backend.supportedVideoPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(backend.supportedVideoPage('https://www.youtube.com/redirect?q=http://127.0.0.1'), false);
    assert.equal(backend.supportedVideoPage('https://youtube.com.attacker.test/watch?v=dQw4w9WgXcQ'), false);
    assert.equal((await api('/api/projects', { headers: { Origin: 'https://evil.example' } })).response.status, 403);
    const badHostStatus = await new Promise((resolve, reject) => { const request = http.get(base + '/api/projects', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
    assert.equal(badHostStatus, 403);
    assert.equal((await api('/api/import', { method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1/secret' }) })).response.status, 400);
    assert.equal((await api('/api/import', { method: 'POST', body: JSON.stringify({ url: 'file:///etc/passwd' }) })).response.status, 400);
    assert.equal((await api('/api/upload?filename=empty.mp4', { method: 'POST', body: '' })).response.status, 400);
    const localSettings = (await api('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultFormat: '1:1', telegramToken: '', telegramChatId: '', storagePath: 'C:/bad' }) })).data.settings;
    assert.equal(localSettings.defaultFormat, '1:1'); assert.equal(localSettings.telegramToken, undefined); assert.notEqual(localSettings.storagePath, 'C:/bad');
    const upload = await api('/api/upload?filename=hello.mp4', { method: 'POST', body: await readFile(input) });
    assert.equal(upload.response.status, 202);
    const ingested = await wait(upload.data.job.id);
    const project = (await api(`/api/projects/${ingested.projectId}`)).data.project;
    assert.ok(project.duration >= 2.8 && project.video && project.hasAudio);
    const range = await fetch(base + project.video, { headers: { Range: 'bytes=0-31' } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32);
    assert.equal((await fetch(base + project.video, { headers: { Range: 'bytes=999999999999-' } })).status, 416);
    assert.equal((await api(`/api/projects/${project.id}/banner?filename=fake.png`, { method: 'POST', body: 'not an image' })).response.status, 422);
    await wait((await api(`/api/projects/${project.id}/analyze`, { method: 'POST' })).data.job.id);
    const analyzed = (await api(`/api/projects/${project.id}`)).data.project;
    assert.ok(analyzed.scenes.length && analyzed.waveform);
    const settings = { ...analyzed.settings, start: 0.25, end: 1.25, format: '9:16', cropX: 30, muted: true, subtitleText: 'Проверка {безопасности} \\ текста\nфинал', subtitleStyle: 'accent', banner: null };
    assert.equal((await api(`/api/projects/${project.id}/export`, { method: 'POST', body: JSON.stringify({ settings: { ...settings, end: 10000 } }) })).response.status, 400);
    const image = path.join(root, 'banner.png');
    assert.equal(spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=100x50', '-frames:v', '1', image], { windowsHide: true }).status, 0);
    const banner = (await api(`/api/projects/${project.id}/banner?filename=banner.png`, { method: 'POST', body: await readFile(image) })).data.banner;
    settings.banner = { ...banner, position: 'bottom', width: 50, start: 0, duration: 1 };
    const exported = await wait((await api(`/api/projects/${project.id}/export`, { method: 'POST', body: JSON.stringify({ settings }) })).data.job.id);
    const clip = (await api('/api/clips')).data.clips.find(item => item.id === exported.clipId);
    assert.ok(clip && clip.subtitleUrl);
    const download = await fetch(base + clip.url); assert.equal(download.status, 200); assert.ok((await download.arrayBuffer()).byteLength > 1000);
    const publication = await api('/api/publications', { method: 'POST', body: JSON.stringify({ clipId: clip.id, platform: 'youtube', caption: 'Тест публикации' }) });
    assert.equal(publication.response.status, 201); assert.equal(publication.data.publication.status, 'draft');
    assert.equal((await api(`/api/publications/${publication.data.publication.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) })).data.publication.status, 'published');
    assert.equal((await api('/api/publications')).data.publications.length, 1);
    assert.equal((await api('/api/telegram/send', { method: 'POST', body: JSON.stringify({ clipId: clip.id }) })).response.status, 400);
    const probe = spawnSync(backend.ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(root, 'data', 'media', `${clip.id}.mp4`)], { windowsHide: true });
    const metadata = JSON.parse(probe.stdout.toString());
    const video = metadata.streams.find(stream => stream.codec_type === 'video');
    assert.equal(video.width / video.height, 9 / 16); assert.equal(metadata.streams.some(stream => stream.codec_type === 'audio'), false);
    assert.ok(Math.abs(Number(metadata.format.duration) - 1) < 0.15);
    const subtitleSource = await readFile(path.join(root, 'data', 'media', `${clip.id}.ass`), 'utf8');
    assert.ok(subtitleSource.includes('｛безопасности｝'));
    assert.ok(subtitleSource.includes('{\\c&HFFCF72&}'));
    assert.ok(subtitleSource.includes('текста\\N{\\c&HFFCF72&}финал{\\c&HFFFFFF&}'), 'accent must color only the final word after a newline');
    const saved = { ...analyzed.settings, cropX: 83 };
    await api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ settings: saved }) });
    const audioJob = await wait((await api(`/api/projects/${project.id}/export`, { method: 'POST', body: JSON.stringify({ settings: { ...settings, format: '16:9', muted: false, subtitleText: '', banner: null } }) })).data.job.id);
    assert.equal((await api(`/api/projects/${project.id}`)).data.project.settings.cropX, 83);
    const audioMetadata = JSON.parse(spawnSync(backend.ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', path.join(root, 'data', 'media', `${audioJob.clipId}.mp4`)], { windowsHide: true }).stdout.toString());
    assert.ok(audioMetadata.streams.some(stream => stream.codec_type === 'audio'));
    assert.equal(audioMetadata.streams.find(stream => stream.codec_type === 'video').width / audioMetadata.streams.find(stream => stream.codec_type === 'video').height, 16 / 9);
    const mediaDir = path.join(root, 'data', 'media');
    const existingMedia = (await readdir(mediaDir)).sort();
    const expectOriginalMedia = async message => {
      for (let attempt = 0; attempt < 100; attempt++) { if (JSON.stringify((await readdir(mediaDir)).sort()) === JSON.stringify(existingMedia)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
      assert.deepEqual((await readdir(mediaDir)).sort(), existingMedia, message);
    };
    const cancelJob = (await api(`/api/projects/${project.id}/export`, { method: 'POST', body: JSON.stringify({ settings: { ...settings, start: 0, end: 3 } }) })).data.job;
    for (let attempt = 0; attempt < 100 && !(await readdir(mediaDir)).some(name => !existingMedia.includes(name)); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    const cancelled = (await api(`/api/jobs/${cancelJob.id}/cancel`, { method: 'POST' })).data.job;
    assert.equal(cancelled.status, 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 200));
    await expectOriginalMedia('cancelled export must remove only its unfinished outputs');
    const realWrite = fs.promises.writeFile;
    const subtitleWriteMock = t.mock.method(fs.promises, 'writeFile', async (file, ...args) => {
      if (String(file).startsWith(mediaDir + path.sep) && String(file).endsWith('.srt')) throw new Error('fixture subtitle write failed');
      return realWrite(file, ...args);
    });
    await wait((await api(`/api/projects/${project.id}/export`, { method: 'POST', body: JSON.stringify({ settings }) })).data.job.id, 'error');
    subtitleWriteMock.mock.restore();
    await expectOriginalMedia('failed export must remove its already-written ASS');
    const realRename = fs.promises.rename;
    const registerMock = t.mock.method(fs.promises, 'rename', async (from, to) => {
      if (String(to) === path.join(root, 'data', 'library.json') && JSON.parse(await readFile(from, 'utf8')).projects.length > 1) throw new Error('fixture project registration failed');
      return realRename(from, to);
    });
    await wait((await api('/api/upload?filename=failed.mp4', { method: 'POST', body: await readFile(input) })).data.job.id, 'error');
    registerMock.mock.restore();
    await expectOriginalMedia('failed ingest registration must remove its MP4/JPG and preserve saved media');
    assert.equal((await api('/api/projects')).data.projects.length, 1);
    const originalFetch = globalThis.fetch;
    let telegramRequests = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (String(url).startsWith('https://api.telegram.org/')) { telegramRequests++; return Response.json({ ok: true, result: { username: 'fixture_bot' } }); }
      return originalFetch(url, options);
    });
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ telegramToken: '123456:abcdefghijklmnopqrstuvwxyz_123456', telegramChatId: '123456' }) });
    const telegramDraft = (await api('/api/publications', { method: 'POST', body: JSON.stringify({ clipId: clip.id, platform: 'telegram', caption: 'Проверка черновика' }) })).data.publication;
    const publicationCount = (await api('/api/publications')).data.publications.length;
    const sent = await api('/api/telegram/send', { method: 'POST', body: JSON.stringify({ clipId: clip.id, publicationId: telegramDraft.id }) });
    assert.equal(sent.data.publication.id, telegramDraft.id);
    assert.equal(sent.data.publication.status, 'published');
    assert.equal((await api('/api/publications')).data.publications.length, publicationCount);
    assert.equal((await api('/api/telegram/send', { method: 'POST', body: JSON.stringify({ clipId: clip.id, publicationId: publication.data.publication.id }) })).response.status, 400);
    assert.equal(telegramRequests, 2, 'invalid publication must be rejected before contacting Telegram');
    fetchMock.mock.restore();
    const jobsBeforeAbort = JSON.parse(await readFile(path.join(root, 'data', 'library.json'), 'utf8')).jobs.length;
    let announceLookup;
    const lookupStarted = new Promise(resolve => { announceLookup = resolve; });
    let dnsCalls = 0;
    const lookupMock = t.mock.method(dns, 'lookup', async () => {
      dnsCalls++; announceLookup(); await new Promise(resolve => setTimeout(resolve, 150));
      if (dnsCalls > 1) throw new Error('unexpected download after client abort');
      return [{ address: '8.8.8.8', family: 4 }];
    });
    syncBuiltinESMExports();
    const abandonedImport = http.request(base + '/api/import', { method: 'POST' });
    abandonedImport.on('error', () => {}); abandonedImport.end(JSON.stringify({ url: 'https://fixture.example/video.mp4' }));
    await lookupStarted; abandonedImport.destroy();
    await new Promise(resolve => setTimeout(resolve, 400));
    lookupMock.mock.restore(); syncBuiltinESMExports();
    assert.equal(JSON.parse(await readFile(path.join(root, 'data', 'library.json'), 'utf8')).jobs.length, jobsBeforeAbort, 'aborted import must not enqueue after DNS resolution');
    const createStream = fs.createWriteStream;
    let announceUpload;
    const uploadFlushed = new Promise(resolve => { announceUpload = resolve; });
    const streamMock = t.mock.method(fs, 'createWriteStream', (file, options) => {
      const stream = createStream(file, options);
      stream._final = function (callback) { announceUpload(); setTimeout(callback, 150); };
      return stream;
    });
    syncBuiltinESMExports();
    const abandonedUpload = http.request(base + '/api/upload?filename=aborted.mp4', { method: 'POST' });
    abandonedUpload.on('error', () => {}); abandonedUpload.end(await readFile(input));
    await uploadFlushed; abandonedUpload.destroy(); await new Promise(resolve => setTimeout(resolve, 500));
    streamMock.mock.restore(); syncBuiltinESMExports();
    assert.equal(JSON.parse(await readFile(path.join(root, 'data', 'library.json'), 'utf8')).jobs.length, jobsBeforeAbort, 'aborted upload must not enqueue after the file stream finishes');
    assert.deepEqual((await readdir(mediaDir)).sort(), existingMedia, 'aborted upload must remove its temporary file');
    let renameAttempts = 0;
    const transientLock = t.mock.method(fs.promises, 'rename', async (from, to) => {
      if (String(to) === path.join(root, 'data', 'library.json') && ++renameAttempts < 3) {
        assert.equal(JSON.parse(await readFile(to, 'utf8')).projects.length, 1, 'existing library remains readable during a retry');
        throw Object.assign(new Error('fixture transient lock'), { code: 'EPERM' });
      }
      return realRename(from, to);
    });
    assert.equal((await api('/api/settings', { method: 'PUT', body: JSON.stringify({ quality: '720p' }) })).response.status, 200, 'transient atomic rename lock must be retried');
    assert.equal(renameAttempts, 3); transientLock.mock.restore();
    const beforeLock = await readFile(path.join(root, 'data', 'library.json'), 'utf8');
    let blockedAttempts = 0;
    const permanentLock = t.mock.method(fs.promises, 'rename', async (from, to) => {
      if (String(to) === path.join(root, 'data', 'library.json')) { blockedAttempts++; throw Object.assign(new Error('fixture persistent lock'), { code: 'EBUSY' }); }
      return realRename(from, to);
    });
    assert.equal((await api('/api/settings', { method: 'PUT', body: JSON.stringify({ quality: '720p' }) })).response.status, 500);
    assert.equal(blockedAttempts, 6, 'persistent lock retries must be bounded');
    assert.equal(await readFile(path.join(root, 'data', 'library.json'), 'utf8'), beforeLock, 'failed atomic rename must preserve the last saved library');
    permanentLock.mock.restore();
    const writeMock = t.mock.method(fs.promises, 'writeFile', async (file, ...args) => {
      if (String(file) === path.join(root, 'data', 'library.json.tmp')) throw Object.assign(new Error('fixture disk write denied'), { code: 'EACCES' });
      return writeFile(file, ...args);
    });
    const failedJob = (await api(`/api/projects/${project.id}/export`, { method: 'POST', body: JSON.stringify({ settings }) })).data.job;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await api(`/api/jobs/${failedJob.id}`)).data.job.status, 'error', 'persistence failure must not leave a running job');
    assert.equal((await api('/api/health')).data.pendingJobs, 0);
    writeMock.mock.restore();
    await new Promise(resolve => server.close(resolve)); server = undefined;
    const persisted = JSON.parse(await readFile(path.join(root, 'data', 'library.json'), 'utf8'));
    assert.equal(persisted.projects.length, 1); assert.equal(persisted.clips.length, 2);
    persisted.jobs.push({ id: 'interrupted', type: 'export', status: 'running', progress: 20 });
    await writeFile(path.join(root, 'data', 'library.json'), JSON.stringify(persisted));
    server = await backend.createServer({ dataDir: path.join(root, 'data'), seed: false });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const restored = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/interrupted`).then(response => response.json());
    assert.equal(restored.job.status, 'error');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    assert.ok(root.startsWith(path.resolve('tmp') + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
