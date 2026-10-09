import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBots } from '../server/telegram-bots.mjs';

const cb = (id, data, update, messageId, text = 'SCENZA · меню') => ({ update_id: update, callback_query: { id: `callback${update}`, from: { id, first_name: 'Тест' }, message: { message_id: messageId, text, chat: { id, type: 'private' } }, data } });
function setup({ editError, alerts = [] } = {}) {
  const sent = [];
  let nextId = 100;
  const user = { id: 'account-1', name: 'Клиент', telegramUserId: '1', role: 'user', blocked: false, accessActive: true, trialEndsAt: '2026-09-20T00:00:00Z' };
  const service = {
    ownerTelegramId: '1',
    adminRole: async id => String(id) === '1' ? 'owner' : null,
    user: async () => user, userByTelegram: async () => user, users: async () => ({ items: [user], total: 1 }), logs: async () => [], promos: async () => [],
    panel: { maintenance: async () => ({ enabled: false }), alerts: async () => alerts, claimAlert: async () => true, releaseAlert: async () => {} },
  };
  const fetch = async (url, init) => {
    const method = url.split('/').at(-1), body = JSON.parse(init.body);
    sent.push({ method, ...body });
    if (method === 'editMessageText' && editError) return { ok: false, status: 400, json: async () => ({ ok: false, error_code: 400, description: editError }) };
    return { ok: true, json: async () => ({ ok: true, result: method === 'sendMessage' ? { message_id: nextId++ } : true }) };
  };
  const bots = createTelegramBots({ clientToken: 'client-secret', adminToken: 'admin-secret', service, siteUrl: 'https://scenza.example', fetch });
  return { bots, sent };
}
const replies = sent => sent.filter(item => ['sendMessage', 'editMessageText'].includes(item.method));

test('a menu button updates the pressed message in place instead of posting a new one', async () => {
  const { bots, sent } = setup();
  await bots.handleAdmin(cb(1, 'adm:home', 1, 55));
  const [reply] = replies(sent);
  assert.equal(reply.method, 'editMessageText');
  assert.equal(reply.message_id, 55);
  assert.match(reply.text, /панель владельца/);
  assert.equal(sent.filter(item => item.method === 'sendMessage').length, 0);
  assert.equal(sent[0].method, 'answerCallbackQuery', 'the button spinner stops before any work');
});

test('a message that cannot be edited falls back to a new message; an unchanged one is left alone', async () => {
  const fallback = setup({ editError: 'Bad Request: message can\'t be edited' });
  await fallback.bots.handleAdmin(cb(1, 'adm:home', 1, 55));
  assert.deepEqual(replies(fallback.sent).map(item => item.method), ['editMessageText', 'sendMessage']);
  const same = setup({ editError: 'Bad Request: message is not modified' });
  await same.bots.handleAdmin(cb(1, 'adm:home', 1, 55));
  assert.deepEqual(replies(same.sent).map(item => item.method), ['editMessageText']);
});

test('alerts are never overwritten: their button opens the panel in a new message', async () => {
  const { bots, sent } = setup({ alerts: [{ key: 'job:error:x', text: 'SCENZA: ошибка обработки' }] });
  await bots.checkNotifications();
  const alert = sent.find(item => item.method === 'sendMessage');
  assert.match(alert.text, /ошибка обработки/);
  await bots.handleAdmin(cb(1, 'adm:home', 1, 100, alert.text));
  assert.equal(sent.filter(item => item.method === 'editMessageText').length, 0);
  assert.match(sent.at(-1).text, /панель владельца/);
});

test('plain text commands still get a new message', async () => {
  const { bots, sent } = setup();
  await bots.handleAdmin({ update_id: 1, message: { message_id: 7, from: { id: 1, first_name: 'Тест' }, chat: { id: 1, type: 'private' }, text: '/start' } });
  assert.deepEqual(replies(sent).map(item => item.method), ['sendMessage']);
});

test('admin panel taps reuse one video snapshot for 15 s and refresh after a job action', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createAdminService } = await import('../server/admin.mjs');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'scenza-cache-'));
  let loads = 0, current = Date.parse('2026-10-09T12:00:00Z');
  const store = { adminSnapshot: async () => { loads++; return { projects: [], jobs: [{ id: 'j1', status: 'error', stage: 'error' }], usage: [] }; }, adminJobAction: async id => ({ id, status: 'cancelled' }) };
  const auth = { bots: { adminRole: async id => id === 'owner' ? 'owner' : null, adminSnapshot: async () => ({ users: [], events: [], promos: [] }) } };
  try {
    const admin = await createAdminService({ auth, dataDir, getVideoApi: async () => ({ store }), now: () => current, env: {} });
    await Promise.all([admin.problems('owner'), admin.problems('owner')]);
    await admin.job('owner', 'j1');
    assert.equal(loads, 1, 'parallel and repeated taps share one database read');
    current += 16000;
    await admin.problems('owner');
    assert.equal(loads, 2, 'snapshot refreshes after 15 s');
    await admin.jobAction('owner', 'j1', 'cancel');
    await admin.problems('owner');
    assert.equal(loads, 3, 'a job action shows fresh data at once');
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
