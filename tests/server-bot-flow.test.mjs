import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createAuth } from '../server/auth.mjs';
import { createTelegramBots } from '../server/telegram-bots.mjs';

test('website Telegram login completes only after private actor confirmation and separate registration consents', async t => {
  const root = path.resolve('tmp');
  await fs.mkdir(root, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(root, 'bot-flow-'));
  const auth = await createAuth({ dataDir, telegramMembership: async () => true, legalReady: true, telegramBotUsername: 'SCENZA_BOT', botRegistrationEnabled: true });
  const sent = [];
  const bots = createTelegramBots({ clientToken: 'fake-client', registrationEnabled: true, service: auth.bots,
    fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, result: true }) }; },
  });
  t.after(async () => { await bots.stop(); await auth.flush(); assert.ok(dataDir.startsWith(root + path.sep)); await fs.rm(dataDir, { recursive: true, force: true }); });
  const headers = new Map();
  let cookie = '', status, response;
  async function call(route, body = {}) {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, socket: { remoteAddress: '127.0.0.1' } });
    headers.clear();
    await auth.handle(request, { setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key), writeHead: value => { status = value; }, end: value => { response = JSON.parse(value); } }, `/api/auth/telegram/bot/${route}`);
    if (headers.has('Set-Cookie')) cookie = headers.get('Set-Cookie').map(value => value.split(';')[0]).join('; ');
    return response;
  }
  let update = 0;
  const msg = (id, text, type = 'private') => ({ update_id: ++update, message: { from: { id, first_name: 'Test' }, chat: { id, type }, text } });
  const cb = (id, data) => ({ update_id: ++update, callback_query: { id: `cb${update}`, from: { id, first_name: 'Test' }, message: { chat: { id, type: 'private' } }, data } });
  const action = prefix => sent.findLast(item => item.reply_markup?.inline_keyboard.flat().some(button => button.callback_data?.startsWith(prefix)))?.reply_markup.inline_keyboard.flat().find(button => button.callback_data?.startsWith(prefix)).callback_data;
  const start = await call('start', { mode: 'login' });
  assert.equal(status, 200);
  const token = new URL(start.url).searchParams.get('start');
  await bots.handleClient(msg(42, `/start ${token}`, 'group'));
  assert.equal(sent.length, 0);
  await bots.handleClient(msg(42, `/start ${token}`));
  const register = action('webregister:');
  assert.ok(register);
  assert.equal((await call('status')).pending, true);
  await bots.handleClient(cb(43, register));
  assert.equal(await auth.bots.userByTelegram(43), null);
  await bots.handleClient(cb(42, register));
  const terms = action('terms:');
  assert.ok(terms);
  await bots.handleClient(cb(42, terms));
  assert.equal(await auth.bots.userByTelegram(42), null);
  await bots.handleClient(cb(42, action('consent:')));
  assert.equal((await call('status')).user.telegramUserId, '42');
  assert.ok(sent.some(item => item.text?.includes('Вернитесь во вкладку сайта')));
  const next = await call('start', { mode: 'login' });
  await bots.handleClient(msg(42, `/start ${new URL(next.url).searchParams.get('start')}`));
  const confirm = action('weblogin:');
  assert.ok(confirm);
  assert.equal((await call('status')).pending, true);
  await bots.handleClient(cb(42, confirm));
  assert.equal((await call('status')).user.telegramUserId, '42');
});

test('bot menus work against the real account service: consent, promo, access, owner roles and audit', async t => {
  const root = path.resolve('tmp');
  await fs.mkdir(root, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(root, 'bot-flow-'));
  const auth = await createAuth({ dataDir, telegramMembership: async () => true, ownerTelegramIds: ['1'], botRegistrationEnabled: true });
  const sent = [];
  const bots = createTelegramBots({ clientToken: 'fake-client', adminToken: 'fake-admin', registrationEnabled: true, service: auth.bots,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push({ method: url.split('/').at(-1), ...body });
      return { ok: true, json: async () => ({ ok: true, result: true }) };
    },
  });
  t.after(async () => { await bots.stop(); await auth.flush(); assert.ok(dataDir.startsWith(root + path.sep)); await fs.rm(dataDir, { recursive: true, force: true }); });
  let update = 0;
  const msg = (id, text) => ({ update_id: ++update, message: { from: { id, first_name: 'Test' }, chat: { id, type: 'private' }, text } });
  const cb = (id, data) => ({ update_id: ++update, callback_query: { id: `cb${update}`, from: { id, first_name: 'Test' }, message: { chat: { id, type: 'private' } }, data } });
  const action = prefix => sent.findLast(item => item.reply_markup?.inline_keyboard.flat().some(button => button.callback_data?.startsWith(prefix)))?.reply_markup.inline_keyboard.flat().find(button => button.callback_data?.startsWith(prefix)).callback_data;
  await bots.handleClient(cb(2, 'register'));
  assert.equal(await auth.bots.userByTelegram(2), null);
  await bots.handleClient(cb(2, action('terms:')));
  assert.equal(await auth.bots.userByTelegram(2), null);
  await bots.handleClient(cb(2, action('consent:')));
  const user = await auth.bots.userByTelegram(2);
  assert.equal(user.trialStartedAt, null);
  assert.equal(user.accessActive, false);
  await bots.handleAdmin(msg(1, '/promo 7 1'));
  await bots.handleAdmin(cb(1, action('confirm:')));
  const code = sent.findLast(item => item.text?.startsWith('Промокод: ')).text.match(/Промокод: ([A-Z0-9]{16})/)[1];
  await bots.handleClient(msg(2, `/redeem ${code}`));
  assert.equal((await auth.bots.userByTelegram(2)).accessActive, true);
  assert.equal((await auth.bots.promos())[0].uses, 1);
  await bots.handleAdmin(msg(1, `/role ${user.id} support`));
  await bots.handleAdmin(cb(1, action('confirm:')));
  assert.equal(await auth.bots.adminRole(2), null);
  await bots.handleAdmin(msg(2, '/promo 30 1'));
  assert.equal((await auth.bots.promos()).length, 1);
  await bots.handleAdmin(msg(1, `/block ${user.id} Нарушение условий`));
  await bots.handleAdmin(cb(1, action('confirm:')));
  assert.equal((await auth.bots.userByTelegram(2)).blocked, true);
  assert.equal(await auth.bots.adminRole(2), null);
  assert.ok((await auth.bots.logs()).some(event => event.event === 'promo.redeem'));
  assert.equal(JSON.stringify(await auth.bots.logs()).includes(code), false);
});
