import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBots } from '../server/telegram-bots.mjs';

const message = (id, text, update_id = 1) => ({ update_id, message: { from: { id }, chat: { id, type: 'private' }, text } });
const callback = (id, data, update_id = 2) => ({ update_id, callback_query: { id: String(update_id), from: { id }, message: { chat: { id, type: 'private' } }, data } });
function fixture() {
  const sent = [], changes = [];
  const panel = {
    maintenance: async () => ({ enabled: false }),
    setMaintenance: async (...args) => { changes.push(args); return { enabled: true }; },
    statistics: async () => ({ users: { total: 3, active: 2 }, generations: { total: 0 }, ai: {} }),
  };
  const service = { panel, adminRole: async id => id === 1 ? 'owner' : id === 2 ? 'support' : null,
    userByTelegram: async () => null, user: async () => ({ id: 'account', name: 'Тест' }),
    block: async (...args) => { changes.push(args); return {}; } };
  const bots = createTelegramBots({ clientToken: 'test', service, fetch: async (url, init) => {
    sent.push({ method: url.split('/').at(-1), ...JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  } });
  const buttons = () => sent.filter(x => x.method === 'sendMessage').at(-1)?.reply_markup?.inline_keyboard.flat() || [];
  return { bots, sent, changes, buttons };
}
test('owner panel provides all sections; support cannot read it', async () => {
  const { bots, sent, buttons } = fixture();
  await bots.handleClient(message(1, '/admin'));
  assert.deepEqual(buttons().map(x => x.text), ['Статистика','Пользователи','Генерации','Платежи','AI / расходы','Промокоды','Рассылка','Ошибки','Состояние системы','Обращения','Журнал','Техработы']);
  await bots.handleClient(callback(2, 'adm:stats'));
  assert.match(sent.at(-1).text, /Доступ к панели не предоставлен/);
});
test('maintenance confirmation is actor bound and cannot be replayed', async () => {
  const { bots, changes, buttons } = fixture();
  await bots.handleClient(callback(1, 'adm:maintenance:on'));
  const confirmation = buttons().find(x => x.text === 'Подтвердить').callback_data;
  await bots.handleClient(callback(2, confirmation, 3));
  assert.equal(changes.length, 0);
  await bots.handleClient(callback(1, confirmation, 4));
  await bots.handleClient(callback(1, confirmation, 5));
  assert.equal(changes.length, 1);
  assert.equal(changes[0][1], true);
});
test('blocking requires a reason before confirmation, retains full reason', async () => {
  const { bots, changes, buttons } = fixture();
  await bots.handleClient(callback(1, 'block:account'));
  assert.equal(changes.length, 0);
  await bots.handleClient(message(1, 'Нарушены условия использования', 3));
  const confirmation = buttons().find(x => x.text === 'Подтвердить').callback_data;
  await bots.handleClient(callback(1, confirmation, 4));
  assert.equal(changes[0][2], true);
  assert.equal(changes[0][4], 'Нарушены условия использования');
});

test('important notifications deduplicate persisted alerts and retry only definite send failure', async () => {
  const claims = new Set(), sent = [];
  let failure = 0;
  const service = { ownerTelegramId: '1', adminRole: async id => String(id) === '1' ? 'owner' : null,
    panel: { alerts: async () => [{ key: 'critical', text: 'Критическая ошибка', cooldownMs: 60000 }],
      claimAlert: async (_, key) => { if (claims.has(key)) return false; claims.add(key); return true; },
      releaseAlert: async (_, key) => claims.delete(key) } };
  const bots = createTelegramBots({ clientToken: 'test', service, fetch: async (_, init) => {
    if (failure === 1) return { ok: false, json: async () => ({ ok: false, error_code: 429 }) };
    if (failure === 2) throw new Error('uncertain');
    sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, result: true }) };
  } });
  await bots.checkNotifications(); await bots.checkNotifications();
  assert.equal(sent.length, 1); assert.equal(sent[0].chat_id, '1');
  claims.clear(); failure = 1;
  await assert.rejects(bots.checkNotifications()); assert.equal(claims.size, 0);
  failure = 0; await bots.checkNotifications(); assert.equal(sent.length, 2);
  claims.clear(); failure = 2;
  await assert.rejects(bots.checkNotifications()); assert.equal(claims.size, 1);
});

test('acknowledged support alerts do not starve later critical alerts', async () => {
  const sent = [];
  const service = { ownerTelegramId: '1', adminRole: async () => 'owner', panel: {
    alerts: async () => [...Array.from({ length: 10 }, (_, i) => ({ key: `seen:${i}`, text: 'already sent' })), { key: 'critical', text: 'Database unavailable' }],
    claimAlert: async (_, key) => key === 'critical', releaseAlert: async () => {},
  } };
  const bots = createTelegramBots({ clientToken: 'test', service, fetch: async (_, init) => {
    sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, result: true }) };
  } });
  await bots.checkNotifications();
  assert.equal(sent.length, 1); assert.equal(sent[0].text, 'Database unavailable');
});
