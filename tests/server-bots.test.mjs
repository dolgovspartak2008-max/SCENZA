import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createTelegramBots } from '../server/telegram-bots.mjs';

const msg = (id, text, update = 1, type = 'private') => ({ update_id: update, message: { from: { id, first_name: 'Тест' }, chat: { id, type }, text } });
const cb = (id, data, update = 2) => ({ update_id: update, callback_query: { id: `callback${update}`, from: { id, first_name: 'Тест' }, message: { chat: { id, type: 'private' } }, data } });
function setup(options = {}) {
  const sent = [], mutations = [];
  const user = { id: 'account-1', name: 'Клиент', telegramUserId: '3', role: 'user', blocked: false, accessActive: true, trialEndsAt: '2026-09-20T00:00:00Z' };
  const service = {
    adminRole: async id => String(id) === '1' ? 'owner' : String(id) === '2' ? 'support' : null,
    user: async () => user, userByTelegram: async () => user,
    users: async () => ({ items: [user], total: 1 }), logs: async () => [],
    grant: async (...args) => { mutations.push(['grant', ...args]); return user; },
    registerTelegram: async (...args) => { mutations.push(['register', ...args]); return user; },
    redeem: async (...args) => { mutations.push(['redeem', ...args]); return user; },
    createPromo: async (...args) => { mutations.push(['promo', ...args]); return { code: 'SCENZA-TEST', days: 7, uses: 0, maxUses: 1 }; },
    promos: async () => [],
    ...options.service,
  };
  const bots = createTelegramBots({ clientToken: 'client-secret', adminToken: 'admin-secret', service, siteUrl: 'https://scenza.example', fetch: async (url, init) => { const method = url.split('/').at(-1); const body = JSON.parse(init.body); sent.push({ method, ...body }); return { ok: true, json: async () => ({ ok: true, result: method === 'getWebhookInfo' ? { url: '' } : true }) }; }, ...options, service });
  return { bots, sent, mutations, service };
}
const confirmation = sent => sent.findLast(item => item.reply_markup?.inline_keyboard.flat().some(button => button.callback_data?.startsWith('confirm:')))?.reply_markup.inline_keyboard.flat().find(button => button.callback_data?.startsWith('confirm:')).callback_data;

test('one bot routes admin commands with role checks and keeps client access for the owner', async () => {
  const { bots, sent, mutations } = setup({ adminToken: undefined });
  await bots.handleClient(msg(1, '/admin', 1));
  assert.match(sent.at(-1).text, /Панель SCENZA/);
  assert.doesNotMatch(sent.at(-1).text, /Роль:/);
  await bots.handleClient(msg(3, '/users', 2));
  assert.match(sent.at(-1).text, /Доступ к панели не предоставлен/);
  await bots.handleClient(msg(2, '/grant 3 7', 3));
  assert.equal(mutations.length, 0);
  await bots.handleClient(msg(1, '/grant 3 7', 4));
  const action = confirmation(sent);
  assert.ok(action);
  await bots.handleClient(cb(3, action, 5));
  assert.equal(mutations.length, 0);
  await bots.handleClient(cb(1, action, 6));
  assert.equal(mutations.length, 1);
  await bots.handleClient(msg(1, '/status', 7));
  assert.match(sent.at(-1).text, /Аккаунт: Клиент/);
});

test('a shared token configures and polls only one Telegram bot', async t => {
  const calls = [];
  const { bots } = setup({ adminToken: 'client-secret', fetch: async (url, init) => {
    const method = url.split('/').at(-1);
    calls.push({ method, ...JSON.parse(init.body) });
    return { ok: method !== 'getUpdates', json: async () => method === 'getUpdates'
      ? { ok: false, error_code: 401 }
      : { ok: true, result: method === 'getWebhookInfo' ? { url: '' } : true } };
  } });
  t.after(() => bots.stop());
  await bots.configure();
  assert.equal(calls.filter(item => item.method === 'setMyCommands').length, 1);
  await bots.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(item => item.method === 'getUpdates').length, 1);
  assert.equal(calls.filter(item => item.method === 'getWebhookInfo').length, 1);
});

test('admin requires owner for every mutation; confirmation is actor-bound and single use', async () => {
  const { bots, sent, mutations } = setup();
  await bots.handleAdmin(msg(3, '/grant 3 7'));
  await bots.handleAdmin(msg(2, '/grant 3 7'));
  await bots.handleAdmin(msg(1, '/grant 3 7', 3, 'group'));
  assert.equal(mutations.length, 0);
  await bots.handleAdmin(msg(1, '/grant 3 7', 4));
  const token = confirmation(sent);
  assert.ok(token);
  await bots.handleAdmin(cb(3, token, 5));
  await bots.handleAdmin(cb(2, token, 6));
  assert.equal(mutations.length, 0);
  await bots.handleAdmin(cb(1, token, 7));
  await bots.handleAdmin(cb(1, token, 8));
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0], ['grant', 1, 'account-1', 7, 'admin:7']);
});

test('support and unknown visitors cannot read admin data; own Telegram id remains available', async () => {
  const { bots, sent } = setup();
  for (const id of [2, 3]) {
    sent.length = 0;
    await bots.handleAdmin(msg(id, '/users', id * 10));
    await bots.handleAdmin(cb(id, 'user:account-1', id * 10 + 1));
    await bots.handleAdmin(msg(id, '/logs', id * 10 + 2));
    assert.ok(sent.filter(item => item.method === 'sendMessage').every(item => /Доступ к панели не предоставлен/.test(item.text)));
    assert.ok(!sent.some(item => item.text?.includes('Клиент')));
    await bots.handleAdmin(msg(id, '/id', id * 10 + 3));
    assert.equal(sent.at(-1).text, `Ваш Telegram ID: ${id}`);
  }
});

test('owner menu and command list do not offer role assignment; legacy actions cannot change roles', async () => {
  let changes = 0;
  const { bots, sent } = setup({ service: { role: async () => { changes++; } } });
  await bots.configure();
  assert.ok(sent.filter(item => item.method === 'setMyCommands').every(item => !item.commands.some(command => command.command === 'role')));
  await bots.handleAdmin(msg(1, '/admin', 1));
  await bots.handleAdmin(cb(1, 'user:account-1', 2));
  assert.ok(sent.filter(item => item.reply_markup).every(item => !item.reply_markup.inline_keyboard.flat().some(button => button.callback_data?.startsWith('role:'))));
  await bots.handleAdmin(msg(1, '/role 3 support', 3));
  await bots.handleAdmin(cb(1, 'role:account-1:support', 4));
  assert.equal(changes, 0);
  assert.match(sent.at(-1).text, /Назначение других администраторов не поддерживается/);
});

test('registration consent can be retried after subscribing without creating an account on failed verification', async () => {
  let subscribed = false, created = 0;
  const { bots, sent } = setup({ registrationEnabled: true, service: {
    userByTelegram: async () => null,
    registerTelegram: async () => {
      if (!subscribed) throw Object.assign(new Error('Подпишитесь на https://t.me/MediaFlowTech и повторите проверку.'), { status: 403 });
      created++;
      return { id: 'new-account', name: 'Клиент', accessActive: false };
    },
  } });
  await bots.handleClient(cb(3, 'register', 1));
  const terms = sent.at(-1).reply_markup.inline_keyboard.flat().find(button => button.callback_data?.startsWith('terms:')).callback_data;
  await bots.handleClient(cb(3, terms, 2));
  const consent = sent.at(-1).reply_markup.inline_keyboard.flat().find(button => button.callback_data?.startsWith('consent:')).callback_data;
  await bots.handleClient(cb(3, consent, 3));
  assert.equal(created, 0);
  assert.match(sent.at(-1).text, /Подпишитесь.*MediaFlowTech/);
  subscribed = true;
  await bots.handleClient(cb(3, consent, 4));
  assert.equal(created, 1);
  assert.match(sent.at(-1).text, /Регистрация завершена/);
  await bots.handleClient(cb(3, consent, 5));
  assert.equal(created, 1);
});

test('registration requires two separate consent steps; no private site links escape', async () => {
  const { bots, sent, mutations } = setup({ registrationEnabled: true, service: { userByTelegram: async () => null } });
  await bots.handleClient(cb(3, 'register'));
  const terms = sent.at(-1).reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('terms:')).callback_data;
  assert.equal(mutations.length, 0);
  await bots.handleClient(cb(3, terms, 3));
  const consent = sent.at(-1).reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('consent:')).callback_data;
  await bots.handleClient(cb(4, consent, 4));
  assert.equal(mutations.length, 0);
  await bots.handleClient(cb(3, consent, 5));
  assert.deepEqual(mutations[0].slice(2), [{ termsAccepted: true, dataConsent: true }, 'client:5']);
  await bots.handleClient(cb(3, consent, 6));
  assert.equal(mutations.length, 1);
  const local = setup({ siteUrl: 'http://localhost:5173', registrationEnabled: true });
  await local.bots.handleClient(msg(3, '/start'));
  await local.bots.handleClient(cb(3, 'register'));
  assert.ok(!JSON.stringify(local.sent).includes('localhost'));
  assert.equal(local.mutations.length, 0);
  assert.ok(local.sent.at(-1).text.includes('Долгов Спартак Сергеевич'));
  const localTerms = local.sent.at(-1).reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('terms:')).callback_data;
  await local.bots.handleClient(cb(3, localTerms, 10));
  assert.ok(local.sent.at(-1).text.includes('Telegram ID'));
  const localConsent = local.sent.at(-1).reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('consent:')).callback_data;
  await local.bots.handleClient(cb(3, localConsent, 11));
  assert.equal(local.mutations.length, 1);
});

test('admin pagination keeps working buttons; expired and cancelled confirmations cannot mutate', async () => {
  let time = 100;
  const { bots, sent, mutations } = setup({ now: () => time, service: { users: async () => ({ items: [{ id: 'account-1', name: 'Клиент' }], total: 20 }) } });
  await bots.handleAdmin(msg(1, '/users'));
  assert.ok(sent.at(-1).reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'users:8'));
  await bots.handleAdmin(msg(1, '/grant 3 7', 2));
  const expired = confirmation(sent);
  time += 300001;
  await bots.handleAdmin(cb(1, expired, 3));
  assert.equal(mutations.length, 0);
  await bots.handleAdmin(msg(1, '/grant 3 7', 4));
  const cancelled = confirmation(sent);
  await bots.handleAdmin(cb(1, 'cancel', 5));
  await bots.handleAdmin(cb(1, cancelled, 6));
  assert.equal(mutations.length, 0);
});

test('privileges are rechecked on confirmation; cancelled signup cannot register', async () => {
  let role = 'owner';
  const { bots, sent, mutations } = setup({ registrationEnabled: true, service: { adminRole: async () => role } });
  await bots.handleAdmin(msg(1, '/grant 3 7'));
  const action = confirmation(sent);
  role = 'support';
  await bots.handleAdmin(cb(1, action, 2));
  assert.equal(mutations.length, 0);
  await bots.handleClient(cb(3, 'register', 3));
  const terms = sent.at(-1).reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('terms:')).callback_data;
  await bots.handleClient(cb(3, terms, 4));
  const consent = sent.at(-1).reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('consent:')).callback_data;
  await bots.handleClient(cb(3, 'cancel', 5));
  await bots.handleClient(cb(3, consent, 6));
  assert.equal(mutations.length, 0);
});

test('promocodes require confirmation; customer can redeem without billing', async () => {
  const { bots, sent, mutations } = setup();
  await bots.handleAdmin(msg(1, '/promo 7 1'));
  assert.equal(mutations.length, 0);
  await bots.handleAdmin(cb(1, confirmation(sent), 2));
  assert.equal(mutations[0][0], 'promo');
  assert.ok(sent.at(-1).text.includes('Активаций: 1'));
  await bots.handleClient(msg(3, '/redeem SCENZA-TEST', 3));
  assert.deepEqual(mutations[1], ['redeem', 3, 'SCENZA-TEST', 'client:3']);
});

test('masked promo records can be revoked by ID; audit details remain readable', async () => {
  const { bots, sent } = setup({ service: { promos: async () => [{ id: 'promo-1', maskedCode: '••••1234', days: 7, uses: 2, maxUses: 5 }], logs: async () => [{ event: 'access.grant', actorId: 1, userId: 'account-1', detail: { days: 7, secret: 'never-display' } }] } });
  await bots.handleAdmin(msg(1, '/promos'));
  assert.ok(sent.at(-1).text.includes('••••1234'));
  assert.ok(sent.at(-1).text.includes('2/5'));
  assert.ok(sent.at(-1).reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'revoke:promo-1'));
  await bots.handleAdmin(msg(1, '/logs', 2));
  assert.ok(sent.at(-1).text.includes('7'));
  assert.ok(!sent.at(-1).text.includes('never-display'));
});

test('polling persists next offset and resumes without discarding queued updates', async t => {
  const root = path.resolve('tmp');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'bots-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await fs.rm(dir, { recursive: true, force: true }); });
  const stateFile = path.join(dir, 'offsets.json');
  let reached, calls = 0;
  const processed = new Promise(resolve => { reached = resolve; });
  const fake = async (url, init) => {
    const method = url.split('/').at(-1);
    if (method === 'getUpdates') {
      calls++;
      if (calls === 1) return { ok: true, json: async () => ({ ok: true, result: [msg(3, '/id', 41)] }) };
      assert.equal(JSON.parse(init.body).offset, 42);
      reached();
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    }
    return { ok: true, json: async () => ({ ok: true, result: method === 'getWebhookInfo' ? { url: '' } : true }) };
  };
  const { bots } = setup({ stateFile, adminToken: undefined, fetch: fake });
  t.after(() => bots.stop());
  await bots.start();
  await processed;
  await bots.stop();
  assert.equal(JSON.parse(await fs.readFile(stateFile, 'utf8')).client, 42);
  let resumed;
  const ready = new Promise(resolve => { resumed = resolve; });
  const next = setup({ stateFile, adminToken: undefined, fetch: async (url, init) => {
    if (url.endsWith('/getUpdates')) { assert.equal(JSON.parse(init.body).offset, 42); resumed(); return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })); }
    return { ok: true, json: async () => ({ ok: true, result: { url: '' } }) };
  } });
  t.after(() => next.bots.stop());
  await next.bots.start();
  await ready;
  await next.bots.stop();
  assert.equal(next.bots.status().client.running, false);
});

test('poller refuses existing webhook without deleting it; errors hide credentials', async () => {
  const calls = [];
  const { bots } = setup({ fetch: async (url) => { calls.push(url.split('/').at(-1)); return { ok: true, json: async () => ({ ok: true, result: { url: 'https://existing.example/hook' } }) }; } });
  await assert.rejects(() => bots.start(), /webhook/i);
  assert.ok(!calls.includes('deleteWebhook'));
  const broken = setup({ fetch: async url => { throw new Error(url); } });
  await assert.rejects(() => broken.bots.configure(), error => !error.message.includes('secret') && !error.message.includes('https://'));
});

test('expired callback acknowledgements do not block processing, but other failures propagate', async () => {
  const sent = [];
  const { bots } = setup({ fetch: async (url, init) => {
    const method = url.split('/').at(-1);
    sent.push({ method, ...JSON.parse(init.body) });
    return { ok: method !== 'answerCallbackQuery', json: async () => method === 'answerCallbackQuery' ? { ok: false, error_code: 400, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' } : { ok: true, result: true } };
  } });
  await bots.handleAdmin(cb(1, 'users:0'));
  assert.ok(sent.some(item => item.text?.includes('Клиент')));
  const network = setup({ fetch: async () => { throw new Error('network'); } });
  await assert.rejects(() => network.bots.handleAdmin(cb(1, 'users:0')));
});

test('successful mutation reply is replayed after a failed send without creating another promo', async () => {
  let fail = true;
  const delivered = [];
  const { bots, mutations } = setup({ fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/sendMessage') && body.text?.includes('Промокод: SCENZA-TEST') && fail) { fail = false; throw new Error('network'); }
    delivered.push(body);
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  } });
  await bots.handleAdmin(msg(1, '/promo 7 1'));
  const confirmationData = confirmation(delivered);
  const update = cb(1, confirmationData, 2);
  await assert.rejects(() => bots.handleAdmin(update));
  assert.equal(mutations.length, 1);
  await bots.handleAdmin(update);
  assert.equal(mutations.length, 1);
  assert.ok(delivered.at(-1).text.includes('Промокод: SCENZA-TEST'));
});

test('one blocked recipient cannot stop polling; authentication failures stop with sanitized health', { timeout: 2000 }, async t => {
  let progressed;
  const ready = new Promise(resolve => { progressed = resolve; });
  const { bots } = setup({ adminToken: undefined, fetch: async (url, init) => {
    const method = url.split('/').at(-1), body = JSON.parse(init.body);
    if (method === 'getUpdates' && body.offset === 0) return { ok: true, json: async () => ({ ok: true, result: [msg(3, '/id', 10)] }) };
    if (method === 'getUpdates') { assert.equal(body.offset, 11); progressed(); return { ok: false, json: async () => ({ ok: false, error_code: 401, description: 'secret' }) }; }
    if (method === 'sendMessage') return { ok: false, json: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }) };
    return { ok: true, json: async () => ({ ok: true, result: { url: '' } }) };
  } });
  t.after(() => bots.stop());
  await bots.start();
  await ready;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bots.status().client.running, false);
  assert.match(bots.status().client.error, /401/);
  assert.ok(!JSON.stringify(bots.status()).includes('secret'));
});

test('temporary polling failures recover beyond five attempts and clear health errors', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const { bots } = setup({ adminToken: undefined, fetch: async (url, init) => {
    if (url.endsWith('/getUpdates')) {
      calls++;
      if (calls <= 6) throw new Error('temporary');
      if (calls === 7) return { ok: true, json: async () => ({ ok: true, result: [] }) };
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    }
    return { ok: true, json: async () => ({ ok: true, result: { url: '' } }) };
  } });
  t.after(() => bots.stop());
  await bots.start();
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(60000);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls >= 8);
  assert.equal(bots.status().client.running, true);
  assert.equal(bots.status().client.error, null);
  await bots.stop();
});

test('undeliverable mutation result retries at most five times without repeating the mutation', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [];
  let deliveries = 0, confirmationData, nextOffset = 0;
  const { bots, mutations } = setup({ clientToken: undefined, fetch: async (url, init) => {
    const method = url.split('/').at(-1), body = JSON.parse(init.body);
    if (method === 'getUpdates') {
      if (!body.offset) return { ok: true, json: async () => ({ ok: true, result: [cb(1, confirmationData, 2)] }) };
      nextOffset = body.offset;
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    }
    if (method === 'sendMessage' && body.text.includes('Промокод: SCENZA-TEST')) { deliveries++; throw new Error('network'); }
    sent.push(body);
    return { ok: true, json: async () => ({ ok: true, result: method === 'getWebhookInfo' ? { url: '' } : true }) };
  } });
  t.after(() => bots.stop());
  await bots.handleAdmin(msg(1, '/promo 7 1'));
  confirmationData = confirmation(sent);
  await bots.start();
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(60000);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deliveries, 5);
  assert.equal(mutations.length, 1);
  assert.equal(nextOffset, 3);
  assert.equal(bots.status().admin.deliveryFailures, 1);
  await bots.stop();
});
