import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server/index.mjs';

test('accounts isolate libraries and media; the free start does not expire by date', async t => {
  const testRoot = path.resolve('tmp');
  await fs.mkdir(testRoot, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(testRoot, 'account-test-'));
  let time = Date.now();
  const mail = new Map();
  const server = await createServer({ dataDir, seed: false, authOptions: { telegramBotUsername: 'SCENZA_BOT', ownerTelegramIds: ['777'], telegramMembership: async () => true, allowedOrigins: ['http://127.0.0.1:5183'], legalReady: true, now: () => time, emailDelivery: async ({ email, code }) => mail.set(email, code) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await server.auth?.flush?.();
    assert.ok(dataDir.startsWith(testRoot + path.sep));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, cookie = '', body) {
    return fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5183', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  let telegramId = 4242;
  async function register(email) {
    const input = { email, password: 'valid-password', mode: 'register', name: `Test ${email}`, termsAccepted: true, dataConsent: true, remember: true };
    const proofResponse = await request('/api/auth/email/start', '', input);
    assert.equal(proofResponse.status, 200);
    const proof = await proofResponse.json();
    const cookie = proofResponse.headers.get('set-cookie').split(';')[0];
    const token = new URL(proof.url).searchParams.get('start').slice(6), id = telegramId++;
    await server.auth.bots.beginWebsiteLogin(token, id); await server.auth.bots.confirmWebsiteLogin(token, id);
    const start = await request('/api/auth/email/start', cookie, input);
    const { challengeId } = await start.json();
    const verified = await request('/api/auth/email/verify', cookie, { challengeId, code: mail.get(email) });
    assert.equal(verified.status, 200);
    return { cookie: verified.headers.get('set-cookie').split(';')[0], ...(await verified.json()) };
  }
  const first = await register('first@example.com');
  const second = await register('second@example.com');
  const firstDir = path.join(dataDir, 'accounts', first.user.id);
  await fs.mkdir(path.join(firstDir, 'media'), { recursive: true });
  await fs.writeFile(path.join(firstDir, 'library.json'), JSON.stringify({ projects: [{ id: 'private-project', title: 'Private' }] }));
  await fs.writeFile(path.join(firstDir, 'media', 'private-project.jpg'), 'private-test-content');
  assert.deepEqual((await (await request('/api/projects', first.cookie)).json()).projects.map(project => project.id), ['private-project']);
  assert.deepEqual((await (await request('/api/projects', second.cookie)).json()).projects, []);
  assert.deepEqual((await (await request('/api/projects')).json()).projects, []);
  assert.equal((await request('/media/private-project.jpg', first.cookie)).status, 200);
  assert.notEqual((await request('/media/private-project.jpg', second.cookie)).status, 200);
  assert.notEqual((await request('/media/private-project.jpg')).status, 200);
  assert.equal((await request('/api/projects', 'scena_session=invalid')).status, 401);
  time += 8 * 86400000;
  // The free start is 10 tokens without a deadline: access stays active, the token balance is the limit.
  assert.equal((await (await request('/api/auth/session', first.cookie)).json()).user.accessActive, true);
  assert.equal((await request('/api/projects', first.cookie)).status, 200);
  const notifications = await (await request('/api/notifications', first.cookie)).json();
  assert.ok(notifications.items.some(item => item.title === 'Стартовые токены' && item.unread));
  assert.equal((await (await request('/api/notifications/read', first.cookie, {})).json()).unread, 0);
  assert.equal((await (await request('/api/notifications', first.cookie)).json()).unread, 0);
  assert.notEqual((await request('/api/notifications')).status, 200);
  const referrals = await (await request('/api/account/referrals', first.cookie)).json();
  assert.deepEqual([referrals.code, referrals.invited, referrals.earned], [first.user.referralCode, [], 0]);
  // Avatars are private to the account and stored as a re-encoded square JPEG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP4y8AARwzIHABuygfpbgaHdgAAAABJRU5ErkJggg==', 'base64');
  const avatarUpload = (cookie, body, type = 'image/png') => fetch(base + '/api/account/avatar', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5183', 'Content-Type': type }, body });
  assert.equal((await request('/api/account/avatar', first.cookie)).status, 404);
  const uploaded = await avatarUpload(first.cookie, png);
  assert.equal(uploaded.status, 200, await uploaded.clone().text()); assert.match((await uploaded.json()).avatar, /^\/api\/account\/avatar\?v=\d+$/);
  const avatar = await request('/api/account/avatar', first.cookie);
  assert.equal(avatar.headers.get('content-type'), 'image/jpeg'); assert.deepEqual([...new Uint8Array(await avatar.arrayBuffer()).slice(0, 2)], [0xff, 0xd8]);
  assert.equal((await request('/api/account/avatar', second.cookie)).status, 404);
  assert.equal((await avatarUpload(first.cookie, Buffer.from('not an image'))).status, 422);
  assert.equal((await avatarUpload(first.cookie, png, 'text/html')).status, 415);
  assert.equal((await fetch(base + '/api/account/avatar', { method: 'DELETE', headers: { Cookie: first.cookie, Origin: 'http://127.0.0.1:5183' } })).status, 200);
  assert.equal((await request('/api/account/avatar', first.cookie)).status, 404);
  // AI work waits for the owner's permission; the refusal tells the user where to ask.
  const session = await (await request('/api/auth/session', first.cookie)).json();
  assert.equal(session.user.aiAccess, false); assert.equal(session.accessContact, 'SCENZA_BOT');
  const refused = await request('/api/video/projects', first.cookie, { name: 'film.mp4', size: 1000 });
  assert.equal(refused.status, 403); assert.match((await refused.json()).error, /Telegram @SCENZA_BOT/);
  assert.equal((await request('/api/video/import', first.cookie, { url: 'https://example.com/a.mp4' })).status, 403);
  await server.auth.bots.grant('777', first.user.id, 30, 'grant-ai-test');
  assert.equal((await (await request('/api/auth/session', first.cookie)).json()).user.aiAccess, true);
  assert.notEqual((await request('/api/video/projects', first.cookie, { name: 'film.mp4', size: 1000 })).status, 403);
  assert.equal((await request('/api/video/projects', second.cookie, { name: 'film.mp4', size: 1000 })).status, 403);
  assert.equal((await request('/api/auth/logout', first.cookie, {})).status, 200);
  assert.equal((await request('/api/projects', first.cookie)).status, 401);
});

test('bot service mode never falls back to an anonymous local studio', async t => {
  const testRoot = path.resolve('tmp');
  await fs.mkdir(testRoot, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(testRoot, 'bot-gate-test-'));
  const server = await createServer({ dataDir, seed: false, allowLocalStudio: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await server.auth?.flush?.();
    assert.ok(dataDir.startsWith(testRoot + path.sep));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/projects')).status, 401);
  assert.equal((await fetch(base + '/media/private.jpg')).status, 401);
  assert.equal((await fetch(base + '/api/settings')).status, 401);
  const session = await (await fetch(base + '/api/auth/session')).json();
  assert.deepEqual(session, { user: null, localStudioAllowed: false, accessContact: 'SCENZA_BOT' });
  assert.equal((await fetch(base + '/api/auth/config')).status, 200);
});
