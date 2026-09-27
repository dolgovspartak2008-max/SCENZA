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
  const server = await createServer({ dataDir, seed: false, authOptions: { telegramBotUsername: 'SCENZA_BOT', telegramMembership: async () => true, allowedOrigins: ['http://127.0.0.1:5183'], legalReady: true, now: () => time, emailDelivery: async ({ email, code }) => mail.set(email, code) } });
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
  assert.deepEqual(session, { user: null, localStudioAllowed: false });
  assert.equal((await fetch(base + '/api/auth/config')).status, 200);
});
