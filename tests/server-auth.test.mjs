import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';

const consent = { termsAccepted: true, dataConsent: true };
const password = 'correct horse battery';

async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.resolve('tmp/auth-test-'));
  const mail = [];
  let clock = Date.UTC(2026, 8, 13);
  const auth = await createAuth({ dataDir, legalReady: true, emailDelivery: async message => mail.push(message), now: () => clock, ...options });
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
    return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
  }
  return { auth, call, mail, dataDir, advance: ms => { clock += ms; }, clock: () => clock, clearCookies: () => { cookies = new Map(); } };
}

test('email requires ownership verification, persists one trial and rejects replay and wrong password', async t => {
  const f = await fixture(t);
  const started = await f.call('/email/start', { mode: 'register', email: 'Person@Example.com', password, remember: true, ...consent });
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
  assert.equal(savedAccount.consent.termsVersion, '2026-09-13');
  assert.equal(savedAccount.consent.dataConsentVersion, '2026-09-13');
  assert.equal('password' in login.body.user, false);
  const restarted = await createAuth({ dataDir: f.dataDir });
  assert.ok(restarted);
  f.advance(86400001);
  assert.equal((await f.call('/session')).body.user, null);
});

test('registration requires separate consents and configured delivery; reset revokes existing sessions', async t => {
  const disabled = await fixture(t, { legalReady: false });
  assert.equal((await disabled.call('/email/start', { mode: 'register', email: 'a@example.com', password, ...consent })).status, 503);
  const unavailable = await fixture(t, { emailDelivery: undefined });
  assert.equal((await unavailable.call('/config')).body.emailEnabled, false);
  assert.equal((await unavailable.call('/email/start', { mode: 'register', email: 'a@example.com', password, ...consent })).status, 503);
  const f = await fixture(t);
  assert.equal((await f.call('/email/start', { mode: 'register', email: 'a@example.com', password, termsAccepted: true })).status, 400);
  const start = await f.call('/email/start', { mode: 'register', email: 'a@example.com', password, ...consent });
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
    const claims = Buffer.from(JSON.stringify({ iss: 'https://oauth.telegram.org', aud: '123456', sub: 'tg-user-1', name: 'Test User', iat: Math.floor(f.clock() / 1000), exp: Math.floor(f.clock() / 1000) + 3600, nonce, ...overrides })).toString('base64url');
    const input = `${header}.${claims}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
  }
  for (const invalid of [{ iss: 'https://evil.example' }, { aud: 'wrong' }, { exp: 1 }, { iat: Math.floor(f.clock() / 1000) + 900 }, { nonce: 'wrong' }]) {
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
  assert.equal((await f.call('/telegram', { idToken, mode: 'register', ...consent }, { Cookie: nonceCookie })).status, 401);
  await f.call('/logout', {});
  f.advance(86400000);
  const next = await f.call('/telegram/challenge', {});
  const login = await f.call('/telegram', { idToken: token(next.body.nonce), mode: 'login' });
  assert.equal(login.body.user.id, registered.body.user.id);
  assert.equal(login.body.user.trialStartedAt, registered.body.user.trialStartedAt);
});

test('auth rejects cross-origin writes and rate-limits login before password work', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/logout', {}, { Origin: 'https://evil.example' })).status, 403);
  let last;
  for (let index = 0; index < 12; index++) last = await f.call('/email/start', { mode: 'login', email: 'missing@example.com', password });
  assert.equal(last.status, 429);
});

test('OTP expires, rejects repeated guessing and cannot create duplicate trial accounts', async t => {
  const f = await fixture(t);
  const start = await f.call('/email/start', { mode: 'register', email: 'otp@example.com', password, ...consent });
  const validCode = f.mail[0].code;
  const wrongCode = validCode === '111111' ? '222222' : '111111';
  for (let index = 0; index < 5; index++) assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: wrongCode })).status, 400);
  assert.equal((await f.call('/email/verify', { challengeId: start.body.challengeId, code: validCode })).status, 429);
  assert.equal((await f.call('/session')).body.user, null);
  const fresh = await f.call('/email/start', { mode: 'register', email: 'otp@example.com', password, ...consent });
  f.advance(10 * 60000 + 1);
  assert.equal((await f.call('/email/verify', { challengeId: fresh.body.challengeId, code: f.mail.at(-1).code })).status, 400);
  const first = await f.call('/email/start', { mode: 'register', email: 'otp@example.com', password, ...consent });
  const firstCode = f.mail.at(-1).code;
  const second = await f.call('/email/start', { mode: 'register', email: 'otp@example.com', password, ...consent });
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
  assert.equal((await f.call('/email/start', { mode: 'register', email: 'short@example.com', password: '1234567', ...consent })).status, 400);
  assert.equal((await f.call('/email/start', { mode: 'register', email: 'valid@example.com', password: '12345678', ...consent })).status, 200);
});
