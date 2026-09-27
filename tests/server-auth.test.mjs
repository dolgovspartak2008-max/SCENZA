import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';

const consent = { termsAccepted: true, dataConsent: true };
const password = 'correct horse battery';

test('Telegram bot login binds browser, requires approval and issues one session without a new trial', async t => {
  const f = await fixture(t, { telegramBotUsername: 'SCENZA_BOT', botRegistrationEnabled: true });
  const user = await f.auth.bots.registerTelegram({ id: 42, name: 'Bot User' }, consent, 'register:42');
  assert.equal((await f.call('/config')).body.telegramBotEnabled, true);
  const start = await f.call('/telegram/bot/start', { mode: 'login', remember: true });
  assert.equal(start.status, 200);
  const token = new URL(start.body.url).searchParams.get('start').slice(6);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(start.cookies.join(' '), /HttpOnly; SameSite=Strict/);
  assert.equal((await f.call('/telegram/bot/status', {})).body.pending, true);
  assert.equal((await f.call('/telegram/bot/status', {}, { Cookie: '' })).status, 410);
  assert.equal((await f.call('/telegram/bot/status', {}, { Cookie: `scena_telegram_bot=${token}.wrong` })).status, 410);
  assert.equal((await f.auth.bots.beginWebsiteLogin(token, 42)).registrationRequired, false);
  await assert.rejects(f.auth.bots.confirmWebsiteLogin(token, 43), /недействительна/);
  await f.auth.bots.confirmWebsiteLogin(token, 42);
  const [a, b] = await Promise.all([f.call('/telegram/bot/status', {}), f.call('/telegram/bot/status', {})]);
  assert.deepEqual([a.status, b.status].sort(), [200, 410]);
  const result = a.status === 200 ? a : b;
  assert.equal(result.body.user.id, user.id);
  assert.equal(result.body.user.accessActive, true);
  assert.match(result.cookies.join(' '), /Max-Age=2592000/);
  assert.equal((await f.call('/session')).body.user.id, user.id);
  await assert.rejects(f.auth.bots.confirmWebsiteLogin(token, 42), /недействительна/);
  await f.restart();
  assert.equal((await f.call('/session')).body.user?.id, user.id);
  const next = await f.call('/telegram/bot/start', { mode: 'login' });
  const nextToken = new URL(next.body.url).searchParams.get('start').slice(6);
  await f.auth.bots.beginWebsiteLogin(nextToken, 42);
  await f.auth.bots.confirmWebsiteLogin(nextToken, 42);
  const again = await f.call('/telegram/bot/status', {});
  assert.equal(again.body.user.trialStartedAt, result.body.user.trialStartedAt);
  assert.equal(again.cookies.some(value => value.startsWith('scena_session=') && value.includes('Max-Age=')), false);
});

test('Telegram bot login expires, replaces old links, rejects cross-site requests and allows blocked accounts to log in', async t => {
  const f = await fixture(t, { telegramBotUsername: 'SCENZA_BOT', botRegistrationEnabled: true, ownerTelegramIds: ['1'] });
  const start = async () => {
    const result = await f.call('/telegram/bot/start', { mode: 'login' });
    assert.equal(result.status, 200);
    return new URL(result.body.url).searchParams.get('start').slice(6);
  };
  assert.equal((await f.call('/telegram/bot/start', { mode: 'login' }, { Origin: 'https://attacker.example' })).status, 403);
  const old = await start();
  const current = await start();
  await assert.rejects(f.auth.bots.beginWebsiteLogin(old, 42), /недействительна/);
  assert.equal((await f.auth.bots.beginWebsiteLogin(current, 42)).registrationRequired, true);
  await assert.rejects(f.auth.bots.confirmWebsiteLogin(current, 42), /зарегистрируйтесь/);
  f.advance(300001);
  await assert.rejects(f.auth.bots.beginWebsiteLogin(current, 42), /недействительна/);
  assert.equal((await f.call('/telegram/bot/status', {})).status, 410);
  const user = await f.auth.bots.registerTelegram({ id: 42, name: 'Bot User' }, consent, 'register:42');
  const blocked = await start();
  await f.auth.bots.beginWebsiteLogin(blocked, 42);
  await f.auth.bots.confirmWebsiteLogin(blocked, 42);
  await f.auth.bots.block(1, user.id, true, 'block:42', 'Нарушение условий');
  assert.equal((await f.call('/telegram/bot/status', {})).body.user.blocked, true);
  const unavailable = await fixture(t, { telegramBotUsername: '' });
  assert.equal((await unavailable.call('/telegram/bot/start', { mode: 'login' })).status, 503);
  const notReady = await fixture(t, { telegramBotUsername: 'SCENZA_BOT', legalReady: false });
  assert.equal((await notReady.call('/telegram/bot/start', { mode: 'register' })).status, 503);
});

test('Telegram polling has a separate budget and cancellation invalidates the browser request', async t => {
  const f = await fixture(t, { telegramBotUsername: 'SCENZA_BOT', botRegistrationEnabled: true });
  const start = await f.call('/telegram/bot/start', { mode: 'register' });
  const token = new URL(start.body.url).searchParams.get('start').slice(6);
  for (let i = 0; i < 65; i++) assert.equal((await f.call('/telegram/bot/status', {})).status, 200);
  assert.equal((await f.call('/telegram/bot/start', { mode: 'invalid' })).status, 400);
  await f.auth.bots.beginWebsiteLogin(token, 42);
  await assert.rejects(f.auth.bots.cancelWebsiteLogin(token, 43), /недействительна/);
  await f.auth.bots.cancelWebsiteLogin(token, 42);
  assert.equal((await f.call('/telegram/bot/status', {})).status, 410);
});

async function fixture(t, options = {}) {
  await fs.mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await fs.mkdtemp(path.resolve('tmp/auth-test-'));
  const mail = [];
  let clock = Date.UTC(2026, 8, 13);
  const authOptions = { dataDir, telegramBotUsername: 'SCENZA_BOT', telegramMembership: async () => true, legalReady: true, emailDelivery: async message => mail.push(message), now: () => clock, ...options };
  let auth = await createAuth(authOptions);
  const server = http.createServer(async (req, res) => {
    if (!await auth.handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(dataDir.startsWith(`${path.resolve('tmp')}${path.sep}auth-test-`));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  let cookies = new Map();
  async function call(route, body, extra = {}) {
    const response = await fetch(`${url}/api/auth${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
    const result = { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
    if (route === '/email/start' && result.body.telegramRequired) {
      const token = new URL(result.body.url).searchParams.get('start').slice(6);
      await auth.bots.beginWebsiteLogin(token, 4242);
      await auth.bots.confirmWebsiteLogin(token, 4242);
      return call(route, body, extra);
    }
    return result;
  }
  return { get auth() { return auth; }, call, mail, dataDir, advance: ms => { clock += ms; }, clock: () => clock, clearCookies: () => { cookies = new Map(); }, restart: async () => { await auth.flush(); auth = await createAuth(authOptions); } };
}

for (const durableStore of [false, true]) test(`sessions survive restart and revocation stays durable (${durableStore ? 'accountStore' : 'local file'})`, async t => {
  let stored;
  const accountStore = durableStore ? { load: async fallback => structuredClone(stored || fallback), save: async next => { stored = structuredClone(next); } } : undefined;
  const f = await fixture(t, { accountStore, ownerTelegramIds: ['1'] });
  const email = 'persistent@example.com';
  const start = await f.call('/email/start', { mode: 'register', name: 'Test User', email, password, remember: true, ...consent });
  const registration = await f.call('/email/verify', { challengeId: start.body.challengeId, code: f.mail.at(-1).code });
  const firstCookie = registration.cookies[0].split(';')[0];
  await f.restart();
  assert.equal((await f.call('/session')).body.user?.id, registration.body.user.id);
  const saved = durableStore ? JSON.stringify(stored) : await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8');
  assert.equal(saved.includes(firstCookie.split('=')[1]), false);
  const login = await f.call('/email/start', { mode: 'login', email, password, remember: true });
  const loginCookie = login.cookies[0].split(';')[0];
  await f.restart();
  assert.equal((await f.call('/session', undefined, { Cookie: firstCookie })).body.user, null);
  assert.equal((await f.call('/session')).body.user?.id, registration.body.user.id);
  await f.call('/logout', {});
  await f.restart();
  assert.equal((await f.call('/session', undefined, { Cookie: loginCookie })).body.user, null);
  const beforeReset = await f.call('/email/start', { mode: 'login', email, password, remember: true });
  const reset = await f.call('/email/start', { mode: 'reset', email, password: 'new persistent password', remember: true });
  assert.equal((await f.call('/email/verify', { challengeId: reset.body.challengeId, code: f.mail.at(-1).code })).status, 200);
  await f.restart();
  assert.equal((await f.call('/session', undefined, { Cookie: beforeReset.cookies[0].split(';')[0] })).body.user, null);
  assert.equal((await f.call('/session')).body.user?.id, registration.body.user.id);
  await f.auth.bots.block(1, registration.body.user.id, true, 'block:persistent', 'Нарушение условий');
  await f.auth.bots.block(1, registration.body.user.id, false, 'unblock:persistent');
  await f.restart();
  assert.equal((await f.call('/session')).body.user.id, registration.body.user.id);
  const temporary = await f.call('/email/start', { mode: 'login', email, password: 'new persistent password', remember: false });
  assert.equal(temporary.cookies[0].includes('Max-Age='), false);
  await f.restart();
  assert.equal((await f.call('/session')).body.user?.id, registration.body.user.id);
  f.advance(86400001);
  assert.equal((await f.call('/session')).body.user, null);
  await f.call('/email/start', { mode: 'login', email, password: 'new persistent password', remember: true });
  f.advance(30 * 86400000 + 1);
  await f.restart();
  assert.equal((await f.call('/session')).body.user, null);
  await f.call('/logout', {});
  const expiredState = durableStore ? stored : JSON.parse(await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8'));
  assert.deepEqual(expiredState.sessions, []);
});

test('legacy account snapshots without sessions still allow password login', async t => {
  const f = await fixture(t);
  const email = 'legacy@example.com';
  const start = await f.call('/email/start', { mode: 'register', name: 'Test User', email, password, ...consent });
  assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: f.mail.at(-1).code })).status, 200);
  const filename = path.join(f.dataDir, 'accounts.json');
  const legacy = JSON.parse(await fs.readFile(filename, 'utf8'));
  delete legacy.sessions;
  await fs.writeFile(filename, JSON.stringify(legacy));
  await f.restart();
  assert.equal((await f.call('/email/start', { mode: 'login', email, password, remember: true })).status, 200);
  await f.restart();
  assert.equal((await f.call('/session')).body.user?.email, email);
});

test('failed session writes preserve the previous durable login and do not issue a cookie', async t => {
  let stored, rejectWrites = false;
  const accountStore = {
    load: async fallback => structuredClone(stored || fallback),
    save: async next => { if (rejectWrites) throw new Error('Storage unavailable'); stored = structuredClone(next); },
  };
  const f = await fixture(t, { accountStore });
  const email = 'atomic@example.com';
  const start = await f.call('/email/start', { mode: 'register', name: 'Test User', email, password, remember: true, ...consent });
  const registration = await f.call('/email/verify', { challengeId: start.body.challengeId, code: f.mail.at(-1).code });
  rejectWrites = true;
  for (const [route, body] of [['/email/start', { mode: 'login', email, password, remember: true }], ['/logout', {}]]) {
    const failed = await f.call(route, body);
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.cookies, []);
    assert.equal((await f.call('/session')).body.user?.id, registration.body.user.id);
    await f.restart();
    assert.equal((await f.call('/session')).body.user?.id, registration.body.user.id);
  }
});

test('email requires ownership verification, persists one trial and rejects replay and wrong password', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/config')).body.emailCodeLength, 6);
  const started = await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'Person@Example.com', password, remember: true, ...consent });
  assert.equal(started.status, 200);
  assert.equal(started.body.verificationRequired, true);
  assert.equal((await f.call('/session')).body.user, null);
  assert.equal(f.mail.length, 1);
  assert.equal(JSON.stringify(started.body).includes(f.mail[0].code), false);
  const verified = await f.call('/email/verify', { challengeId: started.body.challengeId, code: f.mail[0].code });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.email, 'person@example.com');
  const trial = verified.body.user.trialStartedAt;
  assert.equal(Date.parse(verified.body.user.trialEndsAt) - Date.parse(trial), 7 * 86400000);
  assert.equal(verified.body.user.accessActive, true);
  assert.match(verified.cookies.join(' '), /HttpOnly/);
  assert.match(verified.cookies.join(' '), /SameSite=Strict/);
  assert.match(verified.cookies.join(' '), /Max-Age=2592000/);
  assert.equal((await f.call('/email/verify', { challengeId: started.body.challengeId, code: f.mail[0].code })).status, 400);
  assert.equal((await f.call('/logout', {})).status, 200);
  assert.equal((await f.call('/session')).body.user, null);
  assert.equal((await f.call('/email/start', { mode: 'login', email: 'person@example.com', password: 'wrong password' })).status, 401);
  f.advance(8 * 86400000);
  const login = await f.call('/email/start', { mode: 'login', email: 'person@example.com', password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.trialStartedAt, trial);
  assert.equal(login.body.user.accessActive, false);
  const stored = await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8');
  assert.equal(stored.includes(password), false);
  assert.equal(stored.includes(f.mail[0].code), false);
  const savedAccount = JSON.parse(stored).accounts[0];
  assert.equal(savedAccount.trialStartedAt, trial);
  assert.equal(savedAccount.consent.termsVersion, '2026-09-13-public-1');
  assert.equal(savedAccount.consent.dataConsentVersion, '2026-09-13-public-1');
  assert.equal('password' in login.body.user, false);
  const restarted = await createAuth({ dataDir: f.dataDir });
  assert.ok(restarted);
  f.advance(86400001);
  assert.equal((await f.call('/session')).body.user, null);
});

test('registration requires separate consents and configured delivery; reset revokes existing sessions', async t => {
  const disabled = await fixture(t, { legalReady: false });
  assert.equal((await disabled.call('/email/start', { mode: 'register', name: 'Test User', email: 'a@example.com', password, ...consent })).status, 503);
  const unavailable = await fixture(t, { emailDelivery: undefined });
  assert.equal((await unavailable.call('/config')).body.emailEnabled, false);
  assert.equal((await unavailable.call('/email/start', { mode: 'register', name: 'Test User', email: 'a@example.com', password, ...consent })).status, 503);
  const f = await fixture(t);
  assert.equal((await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'a@example.com', password, termsAccepted: true })).status, 400);
  const start = await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'a@example.com', password, ...consent });
  const registration = await f.call('/email/verify', { challengeId: start.body.challengeId, code: f.mail.at(-1).code });
  const oldCookie = registration.cookies[0].split(';')[0];
  const oldSession = (await f.call('/session')).body.user;
  const reset = await f.call('/email/start', { mode: 'reset', email: 'a@example.com', password: 'a new secure password' });
  const confirmed = await f.call('/email/verify', { challengeId: reset.body.challengeId, code: f.mail.at(-1).code });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.user.id, oldSession.id);
  assert.equal(confirmed.body.user.trialStartedAt, oldSession.trialStartedAt);
  assert.equal((await f.call('/session', undefined, { Cookie: oldCookie })).body.user, null);
  assert.equal((await f.call('/email/start', { mode: 'login', email: 'a@example.com', password })).status, 401);
  assert.equal((await f.call('/email/start', { mode: 'login', email: 'a@example.com', password: 'a new secure password' })).status, 200);
});

test('Telegram verifies signature, claims, browser nonce and one-use challenge before giving access', async t => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const f = await fixture(t, { telegramClientId: '123456', fetch: async url => {
    assert.equal(url, 'https://oauth.telegram.org/.well-known/jwks.json');
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  } });
  function token(nonce, overrides = {}, key = privateKey) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: 'https://oauth.telegram.org', aud: '123456', sub: 'tg-user-1', id: 123456789, name: 'Test User', iat: Math.floor(f.clock() / 1000), exp: Math.floor(f.clock() / 1000) + 3600, nonce, ...overrides })).toString('base64url');
    const input = `${header}.${claims}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
  }
  for (const invalid of [{ iss: 'https://evil.example' }, { aud: 'wrong' }, { exp: 1 }, { iat: Math.floor(f.clock() / 1000) + 900 }, { nonce: 'wrong' }, { id: undefined, sub: '123456789' }, { id: null }, { id: '123456789' }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
    const challenge = await f.call('/telegram/challenge', {});
    const result = await f.call('/telegram', { idToken: token(challenge.body.nonce, invalid), mode: 'register', ...consent });
    assert.equal(result.status, 401);
  }
  const forged = await f.call('/telegram/challenge', {});
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal((await f.call('/telegram', { idToken: token(forged.body.nonce, {}, attacker), mode: 'register', ...consent })).status, 401);
  const challenge = await f.call('/telegram/challenge', {});
  const idToken = token(challenge.body.nonce);
  const nonceCookie = challenge.cookies[0].split(';')[0];
  const registered = await f.call('/telegram', { idToken, mode: 'register', ...consent });
  assert.equal(registered.status, 200);
  assert.equal(registered.body.user.provider, 'telegram');
  assert.equal(registered.body.user.telegramUserId, '123456789');
  const stored = JSON.parse(await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8'));
  assert.equal(stored.accounts.length, 1);
  assert.equal(stored.accounts[0].telegramUserId, '123456789');
  assert.equal((await f.call('/telegram', { idToken, mode: 'register', ...consent }, { Cookie: nonceCookie })).status, 401);
  await f.call('/logout', {});
  f.advance(86400000);
  const next = await f.call('/telegram/challenge', {});
  const login = await f.call('/telegram', { idToken: token(next.body.nonce), mode: 'login' });
  assert.equal(login.body.user.id, registered.body.user.id);
  assert.equal(login.body.user.telegramUserId, '123456789');
  assert.equal(login.body.user.trialStartedAt, registered.body.user.trialStartedAt);
});

test('auth rejects cross-origin writes and rate-limits login before password work', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/logout', {}, { Origin: 'https://evil.example' })).status, 403);
  let last;
  for (let index = 0; index < 12; index++) last = await f.call('/email/start', { mode: 'login', email: 'missing@example.com', password });
  assert.equal(last.status, 429);
});

test('trusted loopback proxy keeps rate limits separate for forwarded visitor addresses', async t => {
  const f = await fixture(t, { trustProxy: true });
  for (let index = 0; index < 60; index++) assert.equal((await f.call('/logout', {}, { 'X-Forwarded-For': '192.0.2.1' })).status, 200);
  assert.equal((await f.call('/logout', {}, { 'X-Forwarded-For': '192.0.2.1' })).status, 429);
  assert.equal((await f.call('/logout', {}, { 'X-Forwarded-For': '192.0.2.2' })).status, 200);
  assert.equal((await f.call('/logout', {}, { 'X-Forwarded-For': '2001:db8::1' })).status, 200);
});

test('forwarded headers cannot bypass rate limits unless proxy trust is explicitly enabled', async t => {
  const f = await fixture(t);
  for (let index = 1; index <= 60; index++) assert.equal((await f.call('/logout', {}, { 'X-Forwarded-For': `192.0.2.${index}` })).status, 200);
  assert.equal((await f.call('/logout', {}, { 'X-Forwarded-For': '192.0.2.100' })).status, 429);
});

test('trusted proxy rejects forwarded address lists and malformed addresses', async t => {
  const f = await fixture(t, { trustProxy: true });
  for (let index = 0; index < 60; index++) assert.equal((await f.call('/logout', {})).status, 200);
  for (const value of ['192.0.2.1, 192.0.2.2', 'garbage', '192.0.2.1:443', '999.0.0.1']) {
    assert.equal((await f.call('/logout', {}, { 'X-Forwarded-For': value })).status, 429);
  }
});

test('OTP expires, rejects repeated guessing and cannot create duplicate trial accounts', async t => {
  const f = await fixture(t);
  const start = await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'otp@example.com', password, ...consent });
  const validCode = f.mail[0].code;
  const wrongCode = validCode === '111111' ? '222222' : '111111';
  for (let index = 0; index < 5; index++) assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: wrongCode })).status, 400);
  assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: validCode })).status, 429);
  assert.equal((await f.call('/session')).body.user, null);
  const fresh = await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'otp@example.com', password, ...consent });
  f.advance(10 * 60000 + 1);
  assert.equal((await f.call('/email/verify', { challengeId: fresh.body.challengeId, code: f.mail.at(-1).code })).status, 400);
  const first = await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'otp@example.com', password, ...consent });
  const firstCode = f.mail.at(-1).code;
  const second = await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'otp@example.com', password, ...consent });
  const secondCode = f.mail.at(-1).code;
  const results = await Promise.all([
    f.call('/email/verify', { challengeId: first.body.challengeId, code: firstCode }),
    f.call('/email/verify', { challengeId: second.body.challengeId, code: secondCode }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8')).accounts.length, 1);
});

test('secure mode sets Secure cookie and rejects oversized or non-JSON requests', async t => {
  const f = await fixture(t, { secureCookies: true, telegramClientId: '123456' });
  const challenge = await f.call('/telegram/challenge', {});
  assert.equal(challenge.status, 200);
  assert.match(challenge.cookies[0], /; Secure/);
  assert.equal((await f.call('/logout', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.call('/email/start', { email: 'a'.repeat(25000) })).status, 413);
});

test('existing UI password contract accepts 8 characters and rejects fewer', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'short@example.com', password: '1234567', ...consent })).status, 400);
  assert.equal((await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'valid@example.com', password: '12345678', ...consent })).status, 200);
});

test('external email ownership verification preserves password login and uses the durable account store', async t => {
  let stored;
  const sent = [];
  const accountStore = {
    load: async fallback => structuredClone(stored || fallback),
    save: async value => { stored = structuredClone(value); },
  };
  const emailAuth = {
    send: async message => { sent.push(message); },
    verify: async ({ email, code }) => { assert.equal(email, 'external@example.com'); assert.equal(code.length, 8); if (code !== '12345678') throw Object.assign(new Error('Неверный код.'), { status: 400 }); },
  };
  const f = await fixture(t, { emailDelivery: undefined, emailAuth, accountStore });
  assert.equal((await f.call('/config')).body.emailEnabled, true);
  assert.equal((await f.call('/config')).body.emailCodeLength, 8);
  const start = await f.call('/email/start', { mode: 'register', name: 'Test User', email: 'external@example.com', password, ...consent });
  assert.equal(start.status, 200);
  assert.deepEqual(sent, [{ email: 'external@example.com', purpose: 'register' }]);
  assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: '123456' })).status, 400);
  assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: '87654321' })).status, 400);
  assert.equal((await f.call('/session')).body.user, null);
  const verified = await f.call('/email/verify', { challengeId: start.body.challengeId, code: '12345678' });
  assert.equal(verified.status, 200);
  assert.equal(stored.accounts.length, 1);
  assert.equal(JSON.stringify(stored).includes(password), false);
  assert.equal(JSON.stringify(stored).includes('12345678'), false);
  await assert.rejects(fs.access(path.join(f.dataDir, 'accounts.json')));
  const restarted = await fixture(t, { emailDelivery: undefined, emailAuth, accountStore });
  assert.equal((await restarted.call('/email/start', { mode: 'login', email: 'external@example.com', password })).status, 200);
  assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: '12345678' })).status, 400);
});
