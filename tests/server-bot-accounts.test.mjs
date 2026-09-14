import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';

const accepted = { termsAccepted: true, dataConsent: true };
const owner = '963921711';
const DAY = 86400000;
async function fixture(t, extra = {}) {
  await fs.mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await fs.mkdtemp(path.resolve('tmp/bot-account-test-'));
  let clock = Date.UTC(2026, 8, 13);
  const options = { dataDir, telegramBotUsername: 'SCENZA_BOT', telegramMembership: async () => true, now: () => clock, ownerTelegramIds: [owner], botRegistrationEnabled: true, ...extra };
  const auth = await createAuth(options);
  t.after(async () => {
    assert.ok(dataDir.startsWith(`${path.resolve('tmp')}${path.sep}bot-account-test-`));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { ...auth, dataDir, options, clock: () => clock, advance: days => { clock += days * DAY; }, register: (id, event = `register:${id}`) => auth.bots.registerTelegram({ id, name: `Person ${id}` }, accepted, event) };
}

test('bot registration is explicit, has no running trial and never grants owner to a visitor', async t => {
  const f = await fixture(t);
  assert.equal(typeof f.bots?.registerTelegram, 'function');
  const u = await f.register(101);
  assert.equal(u.role, 'user');
  assert.equal(u.telegramUserId, '101');
  assert.equal(u.trialStartedAt, null);
  assert.equal(u.trialEndsAt, null);
  assert.equal(u.accessActive, false);
  assert.equal(await f.bots.adminRole(101), null);
  assert.equal(await f.bots.adminRole(owner), 'owner');
  assert.equal(await f.bots.adminRole('0963921711'), null);
  assert.equal((await f.register(101)).id, u.id);
  assert.equal((await f.bots.users()).total, 1);
  await assert.rejects(f.bots.registerTelegram({ id: 102, name: 'Other' }, { termsAccepted: true }, 'missing-consent'));
  const disabled = await fixture(t, { botRegistrationEnabled: false });
  await assert.rejects(disabled.register(1), /Регистрация/);
});

test('Windows snapshot rename retries transient locks and preserves saved accounts on permanent failure', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  await f.register(101);
  const rename = fs.rename.bind(fs);
  let attempts = 0;
  const mocked = t.mock.method(fs, 'rename', async (...args) => {
    if (++attempts <= 2) throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' });
    return rename(...args);
  });
  const user = await f.register(102);
  assert.equal(user.telegramUserId, '102');
  assert.equal(attempts, 3);
  const accountsFile = path.join(f.dataDir, 'accounts.json');
  const saved = await fs.readFile(accountsFile, 'utf8');
  assert.equal(JSON.parse(saved).accounts[1].telegramUserId, '102');
  attempts = 0;
  mocked.mock.mockImplementation(async () => {
    attempts++;
    throw Object.assign(new Error('still locked'), { code: 'EBUSY' });
  });
  await assert.rejects(f.register(103), { code: 'EBUSY' });
  assert.equal(attempts, 4);
  assert.equal(await fs.readFile(accountsFile, 'utf8'), saved);
  assert.equal((await f.bots.users()).total, 2);
  assert.deepEqual(await fs.readdir(f.dataDir), ['accounts.json']);
});

test('owner controls roles and access; grants persist and Telegram replay cannot extend twice', async t => {
  const f = await fixture(t);
  const u = await f.register(101);
  await assert.rejects(f.bots.grant('101', u.id, 10, 'unauthorized'), /прав/);
  const granted = await f.bots.grant(owner, u.id, 10, 'grant:1');
  assert.equal(Date.parse(granted.accessUntil), f.clock() + 10 * DAY);
  assert.equal(granted.accessSource, 'grant');
  await f.bots.grant(owner, u.id, 10, 'grant:1');
  assert.equal((await f.bots.user(u.id)).accessUntil, granted.accessUntil);
  const restarted = await createAuth(f.options);
  await restarted.bots.grant(owner, u.id, 10, 'grant:1');
  assert.equal((await restarted.bots.user(u.id)).accessUntil, granted.accessUntil);
  await restarted.bots.role(owner, u.id, 'support', 'role:1');
  assert.equal(await restarted.bots.adminRole(101), null);
  await assert.rejects(restarted.bots.grant('101', u.id, 1, 'support-write'), /прав/);
  await assert.rejects(restarted.bots.role(owner, u.id, 'owner', 'inject-owner'));
  await restarted.bots.block(owner, u.id, true, 'block:1', 'Нарушение условий');
  assert.equal(await restarted.bots.adminRole(101), null);
  assert.equal((await restarted.bots.user(u.id)).accessActive, true);
  await restarted.bots.grant(owner, u.id, 2, 'grant:2');
  assert.equal((await restarted.bots.user(u.id)).blocked, true);
});

test('promo capacity is atomic, one use per account, stored without raw code, replay persistent', async t => {
  const f = await fixture(t);
  await f.register(101); await f.register(102);
  const promo = await f.bots.createPromo(owner, 14, 1, 'promo:create');
  assert.match(promo.code, /^[A-Z0-9]{16}$/);
  await assert.rejects(f.bots.createPromo(owner, 14, 1, 'promo:create'), /уже/);
  const results = await Promise.allSettled([f.bots.redeem(101, promo.code, 'redeem:1'), f.bots.redeem(102, promo.code, 'redeem:2')]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const winner = results.findIndex(item => item.status === 'fulfilled') === 0 ? 101 : 102;
  const event = winner === 101 ? 'redeem:1' : 'redeem:2';
  const before = await f.bots.userByTelegram(winner);
  const restarted = await createAuth(f.options);
  await restarted.bots.redeem(winner, promo.code, event);
  assert.equal((await restarted.bots.userByTelegram(winner)).accessUntil, before.accessUntil);
  await assert.rejects(restarted.bots.redeem(winner, promo.code, 'another-event'));
  assert.equal((await restarted.bots.promos())[0].uses, 1);
  const content = await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8');
  assert.equal(content.includes(promo.code), false);
  assert.equal(JSON.stringify(await restarted.bots.logs({})).includes(promo.code), false);
  const revoked = await restarted.bots.createPromo(owner, 1, 2, 'promo:revoke-test');
  await restarted.bots.revokePromo(owner, revoked.id, 'revoke:1');
  await assert.rejects(restarted.bots.redeem(winner, revoked.code, 'revoke:redeem'));
  const expired = await restarted.bots.createPromo(owner, 1, 2, 'promo:expire-test');
  f.advance(31);
  await assert.rejects(restarted.bots.redeem(winner, expired.code, 'expire:redeem'));
});

test('verified Telegram login binds bot account, starts trial once, and blocked users retain their web sessions', async t => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const f = await fixture(t, { legalReady: true, telegramClientId: '123456', fetch: async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }] })) });
  const original = await f.register(101);
  f.advance(4);
  const server = http.createServer((req, res) => f.handle(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const jar = new Map();
  async function call(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const item of response.headers.getSetCookie()) { const [name, value] = item.split(';')[0].split('='); jar.set(name, value); }
    return { status: response.status, body: await response.json() };
  }
  async function login(id = 101, sub = 'stable-subject') {
    const challenge = await call('/telegram/challenge', {});
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: 'https://oauth.telegram.org', aud: '123456', sub, id, nonce: challenge.body.nonce, iat: f.clock() / 1000, exp: f.clock() / 1000 + 3600 })).toString('base64url');
    const input = `${header}.${claims}`;
    return call('/telegram', { mode: 'login', idToken: `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}` });
  }
  const first = await login();
  assert.equal(first.status, 200);
  assert.equal(first.body.user.id, original.id);
  assert.equal(first.body.user.telegramUserId, '101');
  assert.equal(Date.parse(first.body.user.trialStartedAt), f.clock());
  assert.equal(Date.parse(first.body.user.trialEndsAt), f.clock() + 7 * DAY);
  assert.equal((await f.bots.users()).total, 1);
  f.advance(1);
  assert.equal((await login()).body.user.trialEndsAt, first.body.user.trialEndsAt);
  assert.equal((await login(102)).status, 401);
  assert.equal((await login(null)).status, 401);
  await f.bots.block(owner, original.id, true, 'block:web', 'Нарушение условий');
  assert.equal((await call('/session')).body.user.id, original.id);
  assert.equal((await login()).body.user.blocked, true);
  await f.bots.block(owner, original.id, false, 'unblock:web');
  assert.equal((await call('/session')).body.user.id, original.id);
  assert.equal((await login()).status, 200);
  await call('/logout', {});
  const events = (await f.bots.logs({ userId: original.id })).map(item => item.event);
  assert.ok(events.includes('login')); assert.ok(events.includes('logout')); assert.ok(events.includes('register'));
});

test('activity audit keeps only approved metadata and old account arrays migrate without losing access', async t => {
  const f = await fixture(t);
  const u = await f.register(101);
  await f.bots.recordActivity(u.id, 'studio.telegram_send', { method: 'POST', route: '/api/telegram/send', status: 200, token: 'must-not-persist', filename: 'private-file.txt' });
  const event = (await f.bots.logs({ userId: u.id }))[0];
  assert.deepEqual(event.detail, { method: 'POST', route: '/api/telegram/send', status: 200 });
  await assert.rejects(f.bots.recordActivity(u.id, 'anything', { method: 'GET', route: '/api/projects', status: 200 }));
  await assert.rejects(f.bots.recordActivity(u.id, 'studio.read', { method: 'GET', route: '/media/private-file.txt', status: 200 }));
  const saved = JSON.parse(await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8'));
  await fs.writeFile(path.join(f.dataDir, 'accounts.json'), JSON.stringify(saved.accounts));
  const migrated = await createAuth(f.options);
  assert.equal((await migrated.bots.user(u.id)).trialStartedAt, null);
  await migrated.bots.grant(owner, u.id, 1, 'migration:grant');
  const persisted = JSON.parse(await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8'));
  assert.equal(persisted.accounts[0].id, u.id);
  assert.equal(persisted.events.length, 1);
});

test('password reset rejects an old-password login already queued behind its pending disk write', async t => {
  const mail = [];
  const f = await fixture(t, { legalReady: true, emailDelivery: async message => mail.push(message) });
  const server = http.createServer((req, res) => f.handle(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const jar = new Map();
  async function call(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) });
    for (const c of response.headers.getSetCookie()) { const [k,v] = c.split(';')[0].split('='); jar.set(k,v); }
    const result = { status: response.status, body: await response.json() };
    if (result.body.telegramRequired) {
      const token = new URL(result.body.url).searchParams.get('start').slice(6);
      await f.bots.beginWebsiteLogin(token, 4242); await f.bots.confirmWebsiteLogin(token, 4242);
      return call(route, body);
    }
    return result;
  }
  const email = 'race@example.com', oldPassword = 'old-password-123', newPassword = 'new-password-456';
  const start = await call('/email/start', { mode: 'register', email, password: oldPassword, ...accepted });
  assert.equal((await call('/email/verify', { challengeId: start.body.challengeId, code: mail.at(-1).code })).status, 200);
  const reset = await call('/email/start', { mode: 'reset', email, password: newPassword });
  const originalWrite = fs.writeFile.bind(fs);
  let releaseWrite, markWriteStarted;
  const blocked = new Promise(resolve => { releaseWrite = resolve; });
  const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
  let intercepted = false;
  t.mock.method(fs, 'writeFile', async (...args) => {
    if (!intercepted && typeof args[1] === 'string' && args[1].includes('password.reset')) {
      intercepted = true;
      markWriteStarted();
      await blocked;
    }
    return originalWrite(...args);
  });
  t.after(() => releaseWrite());
  const resetRequest = call('/email/verify', { challengeId: reset.body.challengeId, code: mail.at(-1).code });
  await writeStarted;
  const resetQueue = f.flush();
  const staleLogin = call('/email/start', { mode: 'login', email, password: oldPassword });
  const deadline = Date.now() + 5000;
  while (f.flush() === resetQueue && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  const loginWasQueued = f.flush() !== resetQueue;
  releaseWrite();
  assert.equal(loginWasQueued, true, 'login must pass its password calculation before reset write is released');
  assert.equal((await resetRequest).status, 200);
  assert.equal((await staleLogin).status, 401);
  assert.equal((await call('/email/start', { mode: 'login', email, password: newPassword })).status, 200);
});

test('bot usernames are searchable without becoming account identity; HEAD activity accepts safe metadata', async t => {
  const f = await fixture(t);
  const user = await f.bots.registerTelegram({ id: 101, name: 'Name', username: 'sample_username' }, accepted, 'username:register');
  assert.equal((await f.bots.users({ query: '@sample_username' })).items[0]?.id, user.id);
  const other = await f.bots.registerTelegram({ id: 102, name: 'Other', username: 'sample_username' }, accepted, 'username:other');
  assert.notEqual(other.id, user.id);
  await f.bots.recordActivity(user.id, 'studio.read', { method: 'HEAD', route: '/media/:file', status: 200 });
  assert.ok((await f.bots.user(user.id)).lastActiveAt);
  assert.equal((await f.bots.logs({ userId: user.id })).some(event => event.event === 'studio.read'), false);
});
