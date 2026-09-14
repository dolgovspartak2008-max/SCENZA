import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createAuth } from '../server/auth.mjs';
const accepted = { termsAccepted: true, dataConsent: true };
async function fixture(t, extra = {}) {
  await fs.mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await fs.mkdtemp(path.resolve('tmp/auth-membership-'));
  const mail = [];
  const auth = await createAuth({ dataDir, legalReady: true, telegramBotUsername: 'SCENZA_BOT', botRegistrationEnabled: true, ownerTelegramIds: ['invalid', '1', '2'], emailDelivery: async x => mail.push(x), ...extra });
  const server = http.createServer((req, res) => auth.handle(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const jar = new Map();
  const call = async (route, body, cookie) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie ?? [...jar].map(([k,v]) => `${k}=${v}`).join('; ') }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of response.headers.getSetCookie()) { const [k,v] = c.split(';')[0].split('='); jar.set(k,v); }
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); assert.ok(dataDir.startsWith(path.resolve('tmp') + path.sep)); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { auth, call, mail };
}
test('registration fails closed without membership provider and rejects nonmembers', async t => {
  const missing = await fixture(t);
  await assert.rejects(missing.auth.bots.registerTelegram({ id: 42 }, accepted, 'r'), { status: 503 });
  const f = await fixture(t, { telegramMembership: async () => false });
  await assert.rejects(f.auth.bots.registerTelegram({ id: 42 }, accepted, 'r'), { status: 403 });
  assert.equal((await f.auth.bots.users()).total, 0);
});
test('email registration requires browser-bound verified Telegram, rechecks membership and links one account', async t => {
  let member = true;
  const checked = [];
  const f = await fixture(t, { telegramMembership: async id => { checked.push(id); return member; } });
  const input = { mode: 'register', email: 'linked@example.com', password: 'password123', ...accepted, telegramUserId: '777', subscribed: true };
  const start = await f.call('email/start', input);
  assert.equal(start.body.telegramRequired, true);
  assert.equal(f.mail.length, 0);
  const token = new URL(start.body.url).searchParams.get('start').slice(6);
  assert.equal((await f.auth.bots.beginWebsiteLogin(token, 42)).verificationOnly, true);
  await f.auth.bots.confirmWebsiteLogin(token, 42);
  assert.equal((await f.auth.bots.users()).total, 0);
  assert.equal((await f.call('telegram/bot/status', {})).body.telegramVerified, true);
  const noCookie = await f.call('email/start', input, '');
  assert.equal(noCookie.body.telegramRequired, true);
  // Restore proof using a fresh browser challenge after the other browser issued its cookie.
  const next = await f.call('email/start', input);
  const nextToken = new URL(next.body.url).searchParams.get('start').slice(6);
  await f.auth.bots.beginWebsiteLogin(nextToken, 42); await f.auth.bots.confirmWebsiteLogin(nextToken, 42);
  const existing = await f.auth.bots.registerTelegram({ id: 42, name: 'Telegram User' }, accepted, 'r');
  const email = await f.call('email/start', input);
  assert.equal(email.body.verificationRequired, true);
  member = false;
  assert.equal((await f.call('email/verify', { challengeId: email.body.challengeId, code: f.mail.at(-1).code })).status, 403);
  member = true;
  const verified = await f.call('email/verify', { challengeId: email.body.challengeId, code: f.mail.at(-1).code });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.id, existing.id);
  assert.equal(verified.body.user.email, input.email);
  assert.equal((await f.auth.bots.users()).total, 1);
  assert.ok(checked.every(id => id === '42'));
  await f.call('logout', {});
  assert.equal((await f.call('email/start', { mode: 'login', email: input.email, password: input.password })).body.user.id, existing.id);
});
test('owner is singular, blocked users retain sessions and admin snapshot is sanitized', async t => {
  const f = await fixture(t, { telegramMembership: async () => true });
  const user = await f.auth.bots.registerTelegram({ id: 42 }, accepted, 'r');
  assert.equal(await f.auth.bots.adminRole(1), 'owner');
  assert.equal(await f.auth.bots.adminRole(2), null);
  await f.auth.bots.role(1, user.id, 'support', 'role');
  assert.equal(await f.auth.bots.adminRole(42), null);
  await assert.rejects(f.auth.bots.block(1, user.id, true, 'b'), /причин/);
  const start = await f.call('telegram/bot/start', { mode: 'login' });
  const token = new URL(start.body.url).searchParams.get('start').slice(6);
  await f.auth.bots.beginWebsiteLogin(token, 42); await f.auth.bots.confirmWebsiteLogin(token, 42);
  assert.equal((await f.call('telegram/bot/status', {})).status, 200);
  await f.auth.bots.block(1, user.id, true, 'b', 'Нарушение условий');
  const session = (await f.call('session')).body.user;
  assert.equal(session.id, user.id); assert.equal(session.accessActive, true); assert.equal(session.blockReason, 'Нарушение условий');
  assert.ok(session.createdAt); assert.ok(session.lastActiveAt);
  await assert.rejects(f.auth.bots.adminSnapshot(2), { status: 403 });
  const snapshot = await f.auth.bots.adminSnapshot(1);
  assert.equal(snapshot.accounts.length, 1);
  assert.equal('sessions' in snapshot, false);
  assert.equal('password' in snapshot.accounts[0], false);
});

test('Telegram membership adapter checks bot administrator and accepts only actual membership', async () => {
  const { createTelegramMembership } = await import('../server/telegram-membership.mjs');
  let status = 'member', botStatus = 'administrator', isMember = false, failed = false;
  const calls = [];
  const membership = createTelegramMembership({ botToken: '123:test-secret', fetch: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ method: url.split('/').at(-1), body });
    if (failed) throw new Error('upstream-secret');
    if (url.endsWith('/getMe')) return Response.json({ ok: true, result: { id: 123, is_bot: true } });
    return Response.json({ ok: true, result: { status: body.user_id === 123 ? botStatus : status, is_member: isMember, user: { id: body.user_id } } });
  } });
  for (const value of ['member', 'administrator', 'creator']) { status = value; assert.equal(await membership('42'), true); }
  for (const value of ['left', 'kicked', 'unknown', 'restricted']) { status = value; assert.equal(await membership('42'), false); }
  isMember = true; assert.equal(await membership('42'), true);
  botStatus = 'member'; await assert.rejects(membership('42'));
  botStatus = 'administrator'; failed = true; await assert.rejects(membership('42'));
  assert.ok(calls.filter(x => x.method === 'getChatMember').every(x => x.body.chat_id === '-1004499791967'));
  await assert.rejects(membership('42.5'));
});

test('custom access-day promos enforce expiration, new-user restriction and deletion without code reuse', async t => {
  const f = await fixture(t, { telegramMembership: async () => true });
  const user = await f.auth.bots.registerTelegram({ id: 42 }, accepted, 'r');
  const p = await f.auth.bots.createPromo(1, 3, 5, 'create', { code: 'WELCOME_2026', expiresAt: new Date(Date.now() + 86400000).toISOString(), newUsersOnly: true });
  assert.equal(p.type, 'access_days'); assert.equal(p.newUsersOnly, true); assert.equal(p.code, 'WELCOME_2026');
  const awarded = await f.auth.bots.redeem(42, p.code, 'redeem'); assert.equal(awarded.id, user.id);
  const p2 = await f.auth.bots.createPromo(1, 3, 5, 'create2', { code: 'NEW_ONLY', newUsersOnly: true });
  await assert.rejects(f.auth.bots.redeem(42, p2.code, 'redeem2'));
  await f.auth.bots.deletePromo(1, p.id, 'delete');
  assert.equal((await f.auth.bots.promos()).some(x => x.id === p.id), false);
  await assert.rejects(f.auth.bots.createPromo(1, 3, 5, 'repeat-code', { code: p.code }), /уже/);
  await assert.rejects(f.auth.bots.createPromo(1, 3, 5, 'expired', { expiresAt: '2020-01-01T00:00:00.000Z' }));
  assert.equal(f.auth.bots.ownerTelegramId, '1');
});

test('subscription failure does not consume external email OTP; proof lasts through the email window', async t => {
  let member = true, verifies = 0, clock = Date.now();
  const f = await fixture(t, { now: () => clock, telegramMembership: async () => member, emailAuth: { send: async () => {}, verify: async () => { verifies++; } } });
  const input = { mode: 'register', email: 'external@example.com', password: 'password123', ...accepted };
  const start = await f.call('email/start', input);
  const token = new URL(start.body.url).searchParams.get('start').slice(6);
  await f.auth.bots.beginWebsiteLogin(token, 42); await f.auth.bots.confirmWebsiteLogin(token, 42);
  const email = await f.call('email/start', input);
  member = false;
  assert.equal((await f.call('email/verify', { challengeId: email.body.challengeId, code: '12345678' })).status, 403);
  assert.equal(verifies, 0, 'OTP is not consumed before membership is available');
  member = true;
  clock += 6 * 60000;
  assert.equal((await f.call('email/verify', { challengeId: email.body.challengeId, code: '12345678' })).status, 200);
  assert.equal(verifies, 1);
});

test('ordinary reads update recent activity without flooding the audit journal', async t => {
  let clock = Date.now(), writes = 0, saved;
  const f = await fixture(t, { now: () => clock, telegramMembership: async () => true, accountStore: { load: async fallback => saved || fallback, save: async next => { writes++; saved = structuredClone(next); } } });
  const user = await f.auth.bots.registerTelegram({ id: 42 }, accepted, 'r');
  const before = (await f.auth.bots.logs()).length;
  for (let i = 0; i < 3; i++) await f.auth.bots.recordActivity(user.id, 'studio.read', { method: 'GET', route: '/api/projects', status: 200 });
  assert.equal((await f.auth.bots.logs()).length, before);
  assert.equal(writes, 2, 'Registration plus one activity save');
  clock += 61000;
  await f.auth.bots.recordActivity(user.id, 'studio.read', { method: 'GET', route: '/api/projects', status: 200 });
  assert.equal(writes, 3);
  await f.auth.bots.recordActivity(user.id, 'studio.rejected', { method: 'GET', route: '/api/projects', status: 503 });
  assert.equal((await f.auth.bots.logs())[0].detail.status, 503);
});

test('signed OAuth registration checks membership and existing accounts can still log in after leaving', async t => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clock = Date.now();
  let member = false, checked = [];
  const f = await fixture(t, { now: () => clock, telegramClientId: '123456', telegramMembership: async id => { checked.push(id); return member; }, fetch: async () => Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'RS256' }] }) });
  async function oauth(mode) {
    const challenge = await f.call('telegram/challenge', {});
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: 'https://oauth.telegram.org', aud: '123456', sub: 'verified-subject', id: 42, nonce: challenge.body.nonce, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 600 })).toString('base64url');
    const input = `${header}.${claims}`;
    return f.call('telegram', { mode, ...accepted, idToken: `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}` });
  }
  assert.equal((await oauth('register')).status, 403);
  assert.equal((await f.auth.bots.users()).total, 0);
  member = true;
  const registration = await oauth('register'); assert.equal(registration.status, 200);
  member = false;
  assert.equal((await oauth('login')).body.user.id, registration.body.user.id);
  assert.deepEqual(checked, ['42', '42']);
  assert.equal((await f.auth.bots.users()).total, 1);
});

test('Telegram email proof names the destination and cannot be reused for another email', async t => {
  const f = await fixture(t, { telegramMembership: async () => true });
  const input = { mode: 'register', email: 'intended@example.com', password: 'password123', ...accepted };
  const start = await f.call('email/start', input);
  const token = new URL(start.body.url).searchParams.get('start').slice(6);
  const prompt = await f.auth.bots.beginWebsiteLogin(token, 42);
  assert.equal(prompt.email, input.email);
  await f.auth.bots.confirmWebsiteLogin(token, 42);
  const changed = await f.call('email/start', { ...input, email: 'different@example.com' });
  assert.equal(changed.body.telegramRequired, true);
  assert.equal(f.mail.length, 0);
});
