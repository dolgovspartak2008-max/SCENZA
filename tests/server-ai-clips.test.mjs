import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../server/index.mjs';
import { createStore } from '../server/ai/store.mjs';
import { createVideoApi } from '../server/ai/api.mjs';

test('AI exports join the clip library and publications while preserving account ownership', async () => {
  const root = path.resolve('tmp'), dataDir = await mkdtemp(path.join(root, 'ai-clips-'));
  await writeFile(path.join(dataDir, 'library.json'), JSON.stringify({ clips: [{ id: 'manual-clip', createdAt: '2026-09-12T00:00:00Z' }] }));
  const mail = new Map();
  const server = await createServer({ dataDir, seed: false, authOptions: { legalReady: true, telegramBotUsername: 'SCENZA_BOT', telegramMembership: async () => true, emailDelivery: async ({ email, code }) => mail.set(email, code) } });
  const store = await createStore({ dataDir: path.join(dataDir, 'ai'), env: {} });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = (route, cookie = '', body) => fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let telegramId = 4242;
    const register = async email => {
      const input = { email, password: 'valid-password', mode: 'register', name: `Test ${email}`, termsAccepted: true, dataConsent: true };
      const proofResponse = await api('/api/auth/email/start', '', input);
      const cookie = proofResponse.headers.get('set-cookie').split(';')[0];
      const proof = await proofResponse.json();
      const token = new URL(proof.url).searchParams.get('start').slice(6);
      const id = telegramId++;
      await server.auth.bots.beginWebsiteLogin(token, id); await server.auth.bots.confirmWebsiteLogin(token, id);
      const challenge = await (await api('/api/auth/email/start', cookie, input)).json();
      const response = await api('/api/auth/email/verify', cookie, { challengeId: challenge.challengeId, code: mail.get(email) });
      assert.equal(response.status, 200);
      return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) };
    };
    const first = await register('clips-first@example.com'), second = await register('clips-second@example.com');
    const fileKey = `${first.user.id}/ai-project/export-1.mp4`, file = path.join(dataDir, 'ai', 'objects', fileKey);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'exported-video');
    await store.saveProject(first.user.id, { id: 'ai-project', title: 'AI video', status: 'COMPLETED', createdAt: '2026-09-13T00:00:00Z', candidates: [], versions: [], exports: [{ id: 'export-1', format: '1:1', duration: 5 }], files: { 'export-1': { key: fileKey, mime: 'video/mp4', download: true }, 'preview-only': { key: fileKey, mime: 'video/mp4' } } });
    const clips = (await (await api('/api/clips', first.cookie)).json()).clips;
    assert.equal(clips.length, 1, 'completed AI export must appear in the main clip library');
    const clip = clips[0]; assert.equal(clip.projectUrl, '/ai/ai-project'); assert.equal(clip.format, '1:1');
    assert.equal(await (await api(clip.url, first.cookie)).text(), 'exported-video');
    assert.equal((await api(clip.url, second.cookie)).status, 404);
    assert.deepEqual((await (await api('/api/clips', second.cookie)).json()).clips, []);
    assert.deepEqual((await (await api('/api/clips')).json()).clips.map(item => item.id), ['manual-clip']);
    assert.equal((await api('/api/publications', first.cookie, { clipId: clip.id, platform: 'youtube', caption: 'Local draft' })).status, 201);
    assert.equal((await api('/api/publications', second.cookie, { clipId: clip.id, platform: 'youtube', caption: '' })).status, 400);
    const telegram = await api('/api/telegram/send', first.cookie, { clipId: clip.id });
    assert.equal(telegram.status, 400); assert.match((await telegram.json()).error, /Telegram/);
    assert.equal((await (await api('/api/publications', first.cookie)).json()).publications.length, 1);
    assert.deepEqual((await (await api('/api/publications', second.cookie)).json()).publications, []);
    await store.saveProject('local', { id: 'local-ai', title: 'Earlier export', finalFile: 'older-export', createdAt: '2026-09-13T00:00:00Z', files: { 'older-export': { key: 'local/local-ai/older-export.mp4' } } });
    const localClips = (await (await api('/api/clips')).json()).clips;
    assert.deepEqual(localClips.map(item => item.id), ['ai:local-ai:older-export', 'manual-clip'], 'legacy AI finalFile and manual clips are preserved without duplicates');
    const videoApi = await createVideoApi({ dataDir, env: {} });
    try {
      assert.equal(await videoApi.localClipFile(first.user.id, clip.id), file, 'Telegram reads the existing object without copying media');
      await assert.rejects(() => videoApi.localClipFile(second.user.id, clip.id), /Клип не найден/);
      await assert.rejects(() => videoApi.localClipFile(first.user.id, 'ai:ai-project:preview-only'), /Клип не найден/);
    } finally { videoApi.close(); }
  } finally {
    await new Promise(resolve => server.close(resolve)); store.close();
    await server.auth?.flush?.();
    assert.ok(dataDir.startsWith(root + path.sep));
    await rm(dataDir, { recursive: true, force: true });
  }
});
