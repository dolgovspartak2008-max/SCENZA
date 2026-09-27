import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server/index.mjs';

test('HTTP block, maintenance and expired access preserve account, settings and isolated support while refusing new generation', async t => {
  const root = path.resolve('tmp');
  await fs.mkdir(root, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(root, 'admin-http-'));
  let now = Date.now();
  const owner = '99';
  const server = await createServer({ dataDir, seed: false, allowLocalStudio: false, authOptions: {
    legalReady: true, telegramBotUsername: 'SCENZA_BOT', botRegistrationEnabled: true,
    ownerTelegramIds: [owner], telegramMembership: async () => true, now: () => now,
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await server.auth.flush();
    assert.ok(dataDir.startsWith(root + path.sep));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, cookie = '', body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie, Origin: base, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cookies: response.headers.getSetCookie(), body: await response.json() };
  }
  async function login(id) {
    const account = await server.auth.bots.registerTelegram({ id, name: `Account ${id}` }, { termsAccepted: true, dataConsent: true }, `register:${id}`);
    const start = await call('/api/auth/telegram/bot/start', '', { mode: 'login', remember: true });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const token = new URL(start.body.url).searchParams.get('start').slice(6);
    const challengeCookie = start.cookies.find(value => value.startsWith('scena_telegram_bot=')).split(';')[0];
    await server.auth.bots.beginWebsiteLogin(token, id);
    await server.auth.bots.confirmWebsiteLogin(token, id);
    const completed = await call('/api/auth/telegram/bot/status', challengeCookie, {});
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    return { ...account, cookie: completed.cookies.find(value => value.startsWith('scena_session=')).split(';')[0] };
  }
  const first = await login(101), second = await login(102);
  const panel = server.auth.bots.panel;
  assert.equal((await call('/api/support')).status, 401);
  assert.equal((await call('/api/support', '', { text: 'Guest message' })).status, 401);
  assert.equal((await call('/api/support', first.cookie, { text: '   ' })).status, 400);
  const created = await call('/api/support', first.cookie, { text: 'Не получается загрузить видео.', userId: second.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.ticket.userId, first.id, 'The session determines ticket ownership');
  assert.deepEqual((await call(`/api/support?userId=${first.id}`, second.cookie)).body.tickets, []);
  await panel.replySupport(owner, created.body.ticket.id, 'Попробуйте MP4.', 'reply:1');
  await panel.replySupport(owner, created.body.ticket.id, 'Сообщите размер файла.', 'reply:2');
  assert.deepEqual((await call('/api/support', first.cookie)).body.tickets[0].replies.map(reply => reply.text), ['Попробуйте MP4.', 'Сообщите размер файла.']);

  await server.auth.bots.block(owner, first.id, true, 'block:1', 'Нарушение условий обработки');
  const blockedSession = await call('/api/auth/session', first.cookie);
  assert.equal(blockedSession.status, 200);
  assert.equal(blockedSession.body.user.blocked, true);
  assert.match(blockedSession.body.user.blockReason, /Нарушение условий/);
  for (const route of ['/api/upload', '/api/import', '/api/video/projects', '/api/video/projects/example/analyze']) {
    const response = await call(route, first.cookie, {});
    assert.equal(response.status, 403, route);
    assert.match(response.body.error, /Нарушение условий/);
  }
  assert.equal((await call('/api/settings', first.cookie, { defaultFormat: '1:1' }, 'PUT')).status, 200);
  assert.equal((await call('/api/settings', first.cookie)).body.settings.defaultFormat, '1:1');
  assert.equal((await call('/api/projects', first.cookie)).status, 200);
  assert.equal((await call('/api/support', first.cookie, { text: 'Прошу проверить блокировку.' })).status, 201);

  await server.auth.bots.block(owner, first.id, false, 'unblock:1');
  await panel.setMaintenance(owner, true, 'Обновляем SCENZA. Обработка временно недоступна.');
  for (const route of ['/api/upload', '/api/import', '/api/video/projects', '/api/projects/example/export']) {
    const response = await call(route, first.cookie, {});
    assert.equal(response.status, 503, route);
    assert.match(response.body.error, /Обновляем SCENZA/);
  }
  assert.equal((await call('/api/auth/session', first.cookie)).status, 200);
  assert.equal((await call('/api/settings', first.cookie, { quality: '1080p' }, 'PUT')).status, 200);
  assert.equal((await call('/api/support', first.cookie)).status, 200);
  assert.equal((await call('/api/support', second.cookie, { text: 'Когда закончится обновление?' })).status, 201);
  assert.equal((await call('/api/projects', first.cookie)).status, 200);
  await panel.setMaintenance(owner, false);

  now += 8 * 86400000;
  assert.equal((await call('/api/auth/session', first.cookie)).body.user.accessActive, true);
  assert.equal((await call('/api/settings', first.cookie, { quality: '720p' }, 'PUT')).status, 200);
  assert.equal((await call('/api/settings', first.cookie)).status, 200);
  assert.equal((await call('/api/support', first.cookie, { text: 'Вопрос о продлении доступа.' })).status, 201);
  assert.equal((await call('/api/support', second.cookie)).body.tickets.length, 1);
  assert.equal((await call('/api/auth/logout', first.cookie, {})).status, 200);
  assert.equal((await call('/api/support', first.cookie)).status, 401);
});
