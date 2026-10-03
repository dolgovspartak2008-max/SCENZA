import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import timers from 'node:timers/promises';
import { createTelegramAdmin } from './telegram-admin.mjs';
import { createPhotoSender } from './telegram-photo.mjs';
import { TRIAL_TOKENS } from './ai/tokens.mjs';

const button = (text, callback_data) => ({ text, callback_data });
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 250);
const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК' : '—';
const ownerNotice = 'Самозанятый Долгов Спартак Сергеевич, ИНН 026617773364. Контакт: dolgovspartak2008@gmail.com.';
const termsNotice = `${ownerNotice}\nБот SCENZA создаёт аккаунт, показывает доступ и принимает промокоды. Основная работа с проектами происходит на сайте. Сайт готовится к запуску. При первом входе на сайт мы дарим 10 токенов (10 минут видео) — без срока действия. Карта не требуется; оплата и автоматические списания не подключены. Промокод предоставляет доступ на указанное число дней: срок начинается при его активации. Не передавайте доступ другим лицам и не используйте сервис для незаконных действий. По вопросам доступа и удаления аккаунта обращайтесь по указанной почте. Полные документы сайта пока являются проектами.`;
const privacyNotice = `${ownerNotice}\nЦель обработки — создание аккаунта SCENZA и учёт доступа, входов и промокодов. Данные: Telegram ID, имя, username (если задан), сведения о доступе и технических действиях аккаунта. Действия: получение, запись, хранение, использование, изменение и удаление. Аккаунты хранятся локально на компьютере владельца; сервер ещё не выбран. Telegram также обрабатывает сообщения по своим условиям. Рекламные рассылки и платежи не подключены. Данные аккаунта хранятся до его удаления; сроки хранения технических журналов ещё уточняются. Для отзыва согласия или запроса удаления: dolgovspartak2008@gmail.com. После отзыва регистрация и обслуживание аккаунта могут стать невозможны. Полные документы сайта пока являются проектами.`;
function logDetail(value) {
  if (!value || typeof value !== 'object') return '';
  const labels = { days: 'Дни', role: 'Роль', maxUses: 'Активации', promoId: 'ID промокода', provider: 'Вход', source: 'Источник', method: 'Метод', route: 'Раздел', status: 'Результат', plan: 'Тариф', tokens: 'Токены', referredBy: 'Пригласил' };
  return Object.entries(labels).filter(([key]) => Object.hasOwn(value, key)).map(([key, label]) => `${label}: ${clean(value[key])}`).join('; ');
}
function publicSite(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || isIP(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return '';
    return url.origin;
  } catch { return ''; }
}

export function createTelegramBots({ clientToken, adminToken, service, siteUrl = '', registrationEnabled = false, fetch: fetcher = globalThis.fetch, now = Date.now, stateFile } = {}) {
  const site = publicSite(siteUrl);
  const singleBot = !!clientToken && (!adminToken || adminToken === clientToken);
  const tokens = { client: clientToken, admin: singleBot ? clientToken : adminToken };
  const botTypes = singleBot ? ['client'] : Object.keys(tokens);
  const pending = new Map();
  const completed = new Map();
  const redeemWaiting = new Map();
  const offsets = { client: 0, admin: 0 };
  const health = { client: { running: false, error: null }, admin: { running: false, error: null } };
  let controller, loops = [], starting, notificationTimer, notifying;
  if (stateFile && existsSync(stateFile)) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      for (const type of Object.keys(offsets)) if (Number.isSafeInteger(saved[type]) && saved[type] >= 0) offsets[type] = saved[type];
    } catch { throw new Error('Не удалось прочитать состояние Telegram-ботов.'); }
  }
  function persist() {
    if (!stateFile) return;
    try {
      mkdirSync(path.dirname(stateFile), { recursive: true });
      writeFileSync(`${stateFile}.tmp`, JSON.stringify(offsets), { mode: 0o600 });
      renameSync(`${stateFile}.tmp`, stateFile);
    } catch { throw new Error('Не удалось сохранить состояние Telegram-ботов.'); }
  }
  async function api(type, method, body = {}, signal) {
    if (!tokens[type]) throw new Error(`Telegram ${type}: токен не настроен.`);
    try {
      const response = await fetcher(`https://api.telegram.org/bot${tokens[type]}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const error = new Error(`Telegram ${type}: запрос ${method} не выполнен.`);
        error.telegramFailure = true;
        error.telegramCode = Number(data.error_code) || response.status || 0;
        error.telegramMethod = method;
        error.callbackExpired = method === 'answerCallbackQuery' && data.error_code === 400 && /query is too old|query id is invalid|query_id_invalid|response timeout expired/i.test(String(data.description));
        error.retryAfter = Math.max(1, Math.min(60, Number(data.parameters?.retry_after) || 1));
        throw error;
      }
      return data.result;
    } catch (error) {
      if (error.telegramFailure) throw error;
      const safe = new Error(`Telegram ${type}: соединение недоступно (${method}).`);
      safe.telegramFailure = true;
      safe.telegramMethod = method;
      throw safe;
    }
  }
  const send = (type, id, text, rows = []) => api(type, 'sendMessage', { chat_id: id, text: text.slice(0, 4000), ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) });
  const sendPhoto = createPhotoSender({ clientToken, adminToken, fetch: fetcher, api });
  const panel = service.panel ? createTelegramAdmin({ service, send, api, sendPhoto, complete: completedReply, now }) : null;
  const supportWaiting = new Map();
  async function checkNotifications() {
    if (!panel || !service.ownerTelegramId || !service.panel.alerts) return;
    if (notifying) return notifying;
    notifying = (async () => {
      const ownerId = service.ownerTelegramId;
      if (await service.adminRole(ownerId) !== 'owner') return;
      const alerts = await service.panel.alerts(ownerId);
      let delivered = 0;
      for (const alert of alerts) {
        if (delivered >= 10) break;
        if (!await service.panel.claimAlert(ownerId, alert.key, { cooldownMs: alert.cooldownMs })) continue;
        try { await send('admin', ownerId, alert.text, [[button('Панель SCENZA', 'adm:home')]]); delivered++; }
        catch (error) {
          if (error.telegramCode) await service.panel.releaseAlert(ownerId, alert.key);
          throw error;
        }
      }
    })();
    try { await notifying; } finally { notifying = null; }
  }
  async function completedReply(type, actor, key, text, rows = []) {
    for (const [event, item] of completed) if (item.expires <= now()) completed.delete(event);
    if (completed.size >= 10000) completed.delete(completed.keys().next().value);
    // Retry a committed mutation's reply, including a newly issued code, only in memory.
    completed.set(key, { actor, text, rows, expires: now() + 300000 });
    return send(type, actor, text, rows);
  }
  function session(value) {
    for (const [key, record] of pending) if (record.expires <= now()) pending.delete(key);
    if (pending.size >= 10000) pending.delete(pending.keys().next().value);
    const key = randomBytes(12).toString('hex');
    pending.set(key, { ...value, expires: now() + 300000 });
    return key;
  }
  function consume(key, id, kind) {
    const item = pending.get(key);
    if (!item || item.expires <= now() || item.actor !== id || item.kind !== kind) return null;
    pending.delete(key);
    return item;
  }
  function clientRows() {
    return [[button('Мой доступ', 'status')], [site ? { text: 'Перейти на сайт', url: site } : button('Перейти на сайт', 'site')],
      ...(registrationEnabled ? [[button('Зарегистрироваться', 'register')]] : []),
      [button('Активировать промокод', 'redeem')], [button('Помощь', 'help')], ...(panel ? [[button('Поддержка', 'support')]] : [])];
  }
  function access(user) {
    if (!user) return 'Аккаунт ещё не зарегистрирован.';
    const active = user.accessActive;
    return [`Аккаунт: ${clean(user.name)}`, `Доступ: ${active ? 'активен' : 'неактивен'}`, ...(user.blocked ? [`Создание роликов заблокировано. Причина: ${clean(user.blockReason) || 'обратитесь в поддержку'}. Вход в аккаунт доступен.`] : []),
      user.trialStartedAt ? `Подарочные ${TRIAL_TOKENS} токенов начислены — баланс виден в профиле на сайте. Токены не сгорают.` : `${TRIAL_TOKENS} бесплатных токенов начислятся при первом входе на сайт.`, ...(user.accessUntil ? [`Предоставленный доступ до: ${date(user.accessUntil)}`] : []),
      'Автоматических списаний нет. Оплата пока не подключена.'].join('\n');
  }
  async function client(update, person, text, data) {
    const id = person.id, key = `client:${update.update_id}`;
    const command = text.split(/\s/)[0].split('@')[0].toLowerCase();
    if (panel && (data === 'support' || command === '/support')) {
      for (const [actor, expires] of supportWaiting) if (expires <= now()) supportWaiting.delete(actor);
      if (supportWaiting.size >= 10000) supportWaiting.delete(supportWaiting.keys().next().value);
      supportWaiting.set(id, now() + 600000);
      return send('client', id, 'Напишите вопрос в поддержку SCENZA (до 3000 символов). Ответ появится здесь и в вашем аккаунте на сайте.', [[button('Отмена', 'cancel')]]);
    }
    if (supportWaiting.get(id) > now() && !data && !text.startsWith('/')) {
      if (!text.trim() || text.length > 3000) return send('client', id, 'Сообщение должно содержать 1–3000 символов.');
      const ticket = await service.panel.createSupport(id, text, key);
      supportWaiting.delete(id);
      return completedReply('client', id, key, `Обращение ${ticket.id} принято. Ответ придёт в Telegram и появится на сайте.`, clientRows());
    }
    if (data === 'cancel' || text.startsWith('/')) supportWaiting.delete(id);
    const loginToken = command === '/start' && !data ? text.trim().split(/\s+/)[1]?.match(/^login_([A-Za-z0-9_-]{43})$/)?.[1] : null;
    if (loginToken) {
      const request = await service.beginWebsiteLogin(loginToken, id);
      const code = session({ actor: id, kind: 'websiteLogin', loginToken, verificationOnly: request.verificationOnly });
      const action = request.registrationRequired ? button('Зарегистрироваться и войти', `webregister:${code}`) : button(request.verificationOnly ? 'Проверить подписку и подтвердить' : 'Подтвердить вход', `weblogin:${code}`);
      return send('client', id, `${request.verificationOnly ? `Подпишитесь на MediaFlowTech и подтвердите Telegram для регистрации по email ${clean(request.email)}. Затем вернитесь на сайт и подтвердите эту почту.` : request.registrationRequired ? 'Аккаунта ещё нет. Для регистрации нужна подписка на MediaFlowTech.' : 'Подтвердите вход в SCENZA с вашим Telegram-аккаунтом.'}\nПодтверждайте, только если вы сами начали вход на сайте. Не подтверждайте ссылки, присланные другими людьми. Ссылка действует 5 минут.`, [[{ text: 'Подписаться на MediaFlowTech', url: 'https://t.me/MediaFlowTech' }], [action], [button('Отмена', 'cancel')]]);
    }
    if (data?.startsWith('weblogin:')) {
      const item = consume(data.slice(9), id, 'websiteLogin');
      if (!item) return send('client', id, 'Кнопка недействительна. Начните вход на сайте заново.');
      try { await service.confirmWebsiteLogin(item.loginToken, id); }
      catch (error) { pending.set(data.slice(9), item); throw error; }
      return completedReply('client', id, key, item.verificationOnly ? 'Telegram и подписка подтверждены. Вернитесь на сайт и завершите регистрацию по email.' : 'Вход подтверждён. Вернитесь во вкладку сайта, где вы начали вход: студия откроется автоматически.');
    }
    if (command === '/id') return send('client', id, `Ваш Telegram ID: ${id}`);
    if (command === '/privacy' || data === 'privacy') return send('client', id, privacyNotice, clientRows());
    if (command === '/terms' || data === 'terms') return send('client', id, termsNotice, clientRows());
    if (command === '/site' || data === 'site') return send('client', id, site ? 'Откройте SCENZA и выберите вход через Telegram.' : 'Адрес сайта ещё настраивается. Ссылка появится после подключения домена.', clientRows());
    if (command === '/help' || data === 'help') return send('client', id, 'SCENZA: регистрация, статус доступа и промокоды. Работа с проектами — на сайте. При первом входе на сайт — 10 токенов в подарок. Оплата и автосписания не подключены.\nПоддержка: dolgovspartak2008@gmail.com\n/id — ваш Telegram ID\n/terms — условия\n/privacy — обработка данных.', clientRows());
    if (data === 'register' || data?.startsWith('webregister:') || data?.startsWith('terms:') || data?.startsWith('consent:')) {
      if (!registrationEnabled) return send('client', id, 'Регистрация пока не включена: ожидаем настройки сайта и юридических документов.');
      if (data === 'register' || data.startsWith('webregister:')) {
        const item = data === 'register' ? null : consume(data.slice(12), id, 'websiteLogin');
        if (data !== 'register' && !item) return send('client', id, 'Кнопка недействительна. Начните вход на сайте заново.');
        if (item) await service.beginWebsiteLogin(item.loginToken, id);
        const code = session({ actor: id, kind: 'terms', ...(item ? { loginToken: item.loginToken } : {}) });
        return send('client', id, `Шаг 1 из 2. Условия использования бота.\n\n${termsNotice}`, [...(site ? [[{ text: 'Документы сайта', url: `${site}/legal/terms` }]] : []), [button('Принимаю условия', `terms:${code}`)], [button('Отмена', 'cancel')]]);
      }
      if (data.startsWith('terms:')) {
        const item = consume(data.slice(6), id, 'terms');
        if (!item) return send('client', id, 'Кнопка недействительна. Начните регистрацию заново.', clientRows());
        if (item.loginToken) await service.beginWebsiteLogin(item.loginToken, id);
        const code = session({ actor: id, kind: 'consent', ...(item.loginToken ? { loginToken: item.loginToken } : {}) });
        return send('client', id, `Шаг 2 из 2. Отдельное согласие на обработку данных.\n\n${privacyNotice}\n\nСогласие добровольное. Нажимая кнопку ниже, вы разрешаете указанную обработку для регистрации и обслуживания аккаунта. Без согласия регистрация не завершится.`, [...(site ? [[{ text: 'Согласие на сайте', url: `${site}/legal/consent` }], [{ text: 'Политика на сайте', url: `${site}/legal/privacy` }]] : []), [button('Даю согласие и регистрируюсь', `consent:${code}`)], [button('Отмена', 'cancel')]]);
      }
      const item = consume(data.slice(8), id, 'consent');
      if (!item) return send('client', id, 'Кнопка недействительна. Начните регистрацию заново.', clientRows());
      if (item.loginToken) await service.beginWebsiteLogin(item.loginToken, id);
      let user;
      try { user = await service.registerTelegram({ id, name: [person.first_name, person.last_name].filter(Boolean).join(' '), username: person.username }, { termsAccepted: true, dataConsent: true }, key); }
      catch (error) { pending.set(data.slice(8), item); throw error; }
      if (item.loginToken) {
        await service.confirmWebsiteLogin(item.loginToken, id);
        return completedReply('client', id, key, 'Регистрация завершена, вход подтверждён. Вернитесь во вкладку сайта, где вы начали вход: студия откроется автоматически.');
      }
      return completedReply('client', id, key, `Регистрация завершена.\n${access(user)}`, clientRows());
    }
    if (command === '/redeem' || data === 'redeem') {
      const code = text.trim().split(/\s+/)[1];
      if (!code) {
        for (const [actor, expires] of redeemWaiting) if (expires <= now()) redeemWaiting.delete(actor);
        if (redeemWaiting.size >= 10000) redeemWaiting.delete(redeemWaiting.keys().next().value);
        redeemWaiting.set(id, now() + 300000);
        return send('client', id, 'Отправьте промокод следующим сообщением. Срок предоставленного доступа начнётся сразу после активации, даже если сайт ещё готовится. Для отмены: /start.');
      }
      const user = await service.redeem(id, clean(code), key);
      return completedReply('client', id, key, `Промокод активирован.\n${access(user)}`, clientRows());
    }
    if (text && !text.startsWith('/') && redeemWaiting.get(id) > now()) {
      redeemWaiting.delete(id);
      const user = await service.redeem(id, clean(text.trim()), key);
      return completedReply('client', id, key, `Промокод активирован.\n${access(user)}`, clientRows());
    }
    redeemWaiting.delete(id);
    if (data === 'cancel') for (const [token, item] of pending) if (item.actor === id && item.kind !== 'admin') {
      pending.delete(token);
      if (item.loginToken) await service.cancelWebsiteLogin(item.loginToken, id).catch(() => {});
    }
    return send('client', id, `${command === '/start' ? 'SCENZA\n' : ''}${access(await service.userByTelegram(id))}${site ? '' : '\nАдрес сайта ещё настраивается.'}`, clientRows());
  }
  async function showUser(id, value, owner) {
    const user = await service.user(value);
    if (!user) return send('admin', id, 'Пользователь не найден.');
    const rows = [[button('Журнал аккаунта', `logs:${user.id}`)]];
    if (owner) rows.push([button('Доступ +7 дней', `grant:${user.id}:7`), button('Доступ +30 дней', `grant:${user.id}:30`)],
      [button('Старт · 75 ток.', `plan:${user.id}:start`), button('Про · 170 ток.', `plan:${user.id}:pro`), button('Бизнес · 500 ток.', `plan:${user.id}:business`)],
      [button(user.blocked ? 'Разблокировать' : 'Заблокировать', `${user.blocked ? 'unblock' : 'block'}:${user.id}`)]);
    rows.push([button('К списку', 'users:0')], [button('Главное меню', 'adm:home')]);
    const details = service.panel ? await service.panel.user(id, user.id).catch(() => null) : null;
    return send('admin', id, `${access(user)}\nID: ${clean(user.id)}\nTelegram ID: ${clean(user.telegramUserId) || '—'}\nПочта: ${clean(user.email) || '—'}\nРегистрация: ${date(user.createdAt)}\nПоследняя активность: ${date(user.lastActiveAt)}${details ? `\nСоздано роликов: ${details.videos ?? 'нет данных'}\nУспешных обработок: ${details.successful ?? 'нет данных'}\nОшибок: ${details.errors ?? 'нет данных'}\nИспользовано токенов: ${details.ai?.tokens ?? 'нет данных'}\nЛимит токенов: ${details.ai?.allocatedTokens ?? 'не задан'}\nОстаток: ${details.ai?.remainingTokens ?? 'не задан'}` : ''}`, rows);
  }
  async function admin(update, person, text, data, role) {
    const id = person.id, eventKey = `admin:${update.update_id}`, owner = role === 'owner';
    const [raw, ...args] = text.trim().split(/\s+/);
    const command = (raw || '').split('@')[0].toLowerCase();
    if (command === '/id') return send('admin', id, `Ваш Telegram ID: ${id}`);
    if (!owner) return send('admin', id, 'Доступ к панели не предоставлен. /id — ваш Telegram ID.');
    if (panel && await panel.handle(id, text, data, eventKey, update.message || {})) return;
    if (data === 'cancel' || data === 'admincancel') {
      for (const [token, item] of pending) if (item.actor === id && item.kind === 'admin') pending.delete(token);
      return send('admin', id, 'Действие отменено.');
    }
    if (command === '/users' || command === '/find' || data?.startsWith('users:')) {
      const offset = Math.max(0, Number(data?.split(':')[1]) || 0);
      const query = command === '/find' ? args.join(' ').slice(0, 100) : '';
      if (command === '/find' && !query) return send('admin', id, 'Поиск: /find имя, почта или Telegram ID');
      const result = await service.users({ query, offset, limit: 8 });
      const rows = result.items.map(user => [button(`${clean(user.name).slice(0, 40)} · ${user.blocked ? 'заблокирован' : user.accessActive ? 'активен' : 'неактивен'}`, `user:${user.id}`)]);
      const navigation = [...(offset > 0 ? [button('Назад', `users:${Math.max(0, offset - 8)}`)] : []), ...(offset + 8 < result.total ? [button('Далее', `users:${offset + 8}`)] : [])];
      if (!query && navigation.length) rows.push(navigation);
      rows.push([button('Поиск', 'adm:search')], [button('Главное меню', 'adm:home')]);
      return send('admin', id, `Пользователи: ${result.total}\n${result.items.map(user => `${clean(user.name)} · ${clean(user.id)}`).join('\n') || 'Ничего не найдено.'}`, rows);
    }
    if (data?.startsWith('user:')) return showUser(id, data.slice(5), owner);
    if (command === '/logs' || data?.startsWith('logs:')) {
      const userId = data ? data.slice(5) : args[0];
      const logs = await service.logs({ userId, limit: 15 });
      return send('admin', id, `Журнал действий\n${logs.map(item => `${date(item.at)} · ${clean(item.event)}\nАккаунт: ${clean(item.userId) || '—'}; инициатор: ${clean(item.actorId) || '—'}\n${logDetail(item.detail)}`).join('\n\n') || 'Записей нет.'}`, [[button('Главное меню', 'adm:home')]]);
    }
    if (command === '/promos' || data === 'promos' || data?.startsWith('promos:')) {
      if (!owner) return send('admin', id, 'Изменения и промокоды доступны только владельцу.');
      const promos = await service.promos();
      const offset = Math.max(0, Number(data?.split(':')[1]) || 0);
      const recent = promos.slice(offset, offset + 8);
      const rows = recent.map(item => [...(!item.revoked ? [button(`Отключить ${clean(item.maskedCode)}`, `revoke:${item.id}`)] : []), ...(panel ? [button(`Удалить ${clean(item.maskedCode)}`, `adm:deletepromo:${item.id}`)] : [])]).filter(row => row.length);
      rows.push([button('Создать промокод', 'adm:promo')], [button('Главное меню', 'adm:home')]);
      if (offset || offset + 8 < promos.length) rows.splice(-2, 0, [...(offset ? [button('Назад', `promos:${Math.max(0,offset-8)}`)] : []), ...(offset+8 < promos.length ? [button('Далее', `promos:${offset+8}`)] : [])]);
      return send('admin', id, `Последние промокоды\n${recent.map(item => `${clean(item.maskedCode)} · ${item.days} дн. · ${item.uses}/${item.maxUses} · ${item.revoked ? 'отключён' : 'включён'}\nДействует до: ${date(item.expiresAt)}${item.newUsersOnly ? '\nТолько новые пользователи' : ''}`).join('\n\n') || 'Промокодов нет.'}\nПолный код показывается только при создании. Для отключения используйте кнопку или /revoke КОД.`, rows);
    }
    if (data?.startsWith('confirm:')) {
      if (!owner) return send('admin', id, 'Изменения доступны только владельцу.');
      const item = consume(data.slice(8), id, 'admin');
      if (!item) return send('admin', id, 'Подтверждение уже использовано или истекло.');
      const result = item.method === 'block' ? await service.block(id, ...item.args, eventKey, item.reason) : await service[item.method](id, ...item.args, eventKey);
      if (item.method === 'createPromo') return completedReply('admin', id, eventKey, `Промокод: ${clean(result.code)}\nДоступ: ${result.days} дней\nАктиваций: ${result.maxUses}\nДействует до: ${date(result.expiresAt)}\nСохраните код: повторно он не показывается. Клиент активирует: /redeem КОД. Дни доступа начнутся сразу при активации.`);
      return completedReply('admin', id, eventKey, 'Изменение сохранено.');
    }
    const action = data?.split(':')[0] || command.slice(1);
    if (action === 'role') return send('admin', id, 'Админ-панель доступна только владельцу. Назначение других администраторов не поддерживается.');
    if (['grant', 'block', 'unblock', 'promo', 'revoke', 'plan'].includes(action)) {
      if (!owner) return send('admin', id, 'Изменения доступны только владельцу.');
      const values = data ? data.split(':').slice(1) : args;
      let method, params, description, reason;
      if (action === 'promo') {
        const days = Number(values[0]), uses = Number(values[1] ?? 1);
        if (!Number.isSafeInteger(days) || days < 1 || days > 365 || !Number.isSafeInteger(uses) || uses < 1 || uses > 1000) return send('admin', id, 'Формат: /promo ДНИ [АКТИВАЦИИ]. Дни: 1–365, активации: 1–1000.');
        method = 'createPromo'; params = [days, uses]; description = `Создать промокод: ${days} дней, ${uses} активаций?`;
      } else if (action === 'revoke') {
        if (!values[0]) return send('admin', id, 'Формат: /revoke КОД');
        method = 'revokePromo'; params = [clean(values[0])]; description = `Отозвать промокод ${clean(values[0])}?`;
      } else {
        if (!values[0]) return send('admin', id, 'Укажите ID аккаунта или Telegram ID после команды.');
        const user = await service.user(values[0]);
        if (!user) return send('admin', id, 'Пользователь не найден.');
        if (action === 'plan') {
          const plans = { start: 'Старт · 75 токенов', pro: 'Про · 170 токенов', business: 'Бизнес · 500 токенов' };
          if (!plans[values[1]]) return send('admin', id, 'Формат: /plan ID start|pro|business');
          method = 'activatePlan'; params = [user.id, values[1]]; description = `Активировать тариф ${plans[values[1]]} и +30 дней доступа после оплаты`;
        } else if (action === 'grant') {
          const days = Number(values[1]);
          if (!Number.isSafeInteger(days) || days < 1 || days > 365) return send('admin', id, 'Формат: /grant ID ДНИ. Допустимо 1–365 дней.');
          method = 'grant'; params = [user.id, days]; description = `Добавить ${days} дней доступа`;
        } else if (action === 'role') {
          if (!['user', 'support'].includes(values[1])) return send('admin', id, 'Формат: /role ID user|support. Поддержка может только просматривать данные.');
          method = 'role'; params = [user.id, values[1]]; description = `Назначить роль ${values[1]}`;
        } else {
          method = 'block'; params = [user.id, action === 'block']; description = action === 'block' ? 'Запретить создание роликов' : 'Снять блокировку';
          if (action === 'block') {
            reason = values.slice(1).join(' ').trim();
            if (!reason || reason.length > 500) return send('admin', id, 'Укажите причину: /block ID ПРИЧИНА (до 500 символов).');
            description += `\nПричина: ${reason}`;
          }
        }
        description += `\nАккаунт: ${clean(user.name)} (${clean(user.id)})?`;
      }
      const code = session({ actor: id, kind: 'admin', method, args: params, reason });
      return send('admin', id, `${description}\nПодтверждение действует 5 минут.`, [[button('Подтвердить', `confirm:${code}`), button('Отмена', singleBot ? 'admincancel' : 'cancel')]]);
    }
    if (panel) return panel.home(id);
    return send('admin', id, 'Панель SCENZA', [[button('Пользователи', 'users:0'), button('Журнал', 'logs:')], [button('Промокоды', 'promos')]]);
  }
  async function handle(type, update) {
    const callback = update?.callback_query;
    const message = callback?.message || update?.message;
    const person = callback?.from || message?.from;
    if (!person || !Number.isSafeInteger(person.id) || !Number.isSafeInteger(update.update_id)) return;
    if (singleBot && type === 'client') {
      const command = (message?.text || '').trim().split(/\s/)[0].split('@')[0].toLowerCase();
      const adminCommand = /^\/(?:admin|users|find|logs|grant|plan|block|unblock|role|promo|promos|revoke)$/.test(command);
      const adminCallback = /^(?:adm:|admin$|admincancel$|users:|user:|logs:|grant:|plan:|block:|unblock:|role:|promo:|promos(?::|$)|revoke:|confirm:)/.test(callback?.data || '');
      if (callback ? adminCallback : adminCommand || panel?.hasPending(person.id)) type = 'admin';
    }
    // Recheck current privileges even for old buttons and private-chat mismatches.
    const currentRole = type === 'admin' ? await service.adminRole(person.id) : null;
    const role = currentRole === 'owner' ? currentRole : null;
    if (message?.chat?.type !== 'private' || message.chat.id !== person.id || person.is_bot) return;
    if (callback) {
      try { await api(type, 'answerCallbackQuery', { callback_query_id: callback.id }); }
      catch (error) { if (!error.callbackExpired) throw error; }
    }
    const key = `${type}:${update.update_id}`;
    const reply = completed.get(key);
    if (reply?.expires <= now()) completed.delete(key);
    else if (reply?.actor === person.id && (type !== 'admin' || role === 'owner')) return send(type, person.id, reply.text, reply.rows);
    try {
      await (type === 'client' ? client(update, person, message.text || '', callback?.data) : admin(update, person, message.text || '', callback?.data, role));
    } catch (error) {
      if (error.telegramFailure) throw error;
      const membership = /^(?:Для регистрации подпишитесь|Не удалось проверить подписку)/.test(error.message);
      await send(type, person.id, error.status && error.status < 500 || membership ? error.message : 'Не удалось выполнить действие. Сервис временно недоступен. Попробуйте позже.', type === 'client' ? membership ? [[{ text: 'Подписаться на MediaFlowTech', url: 'https://t.me/MediaFlowTech' }]] : clientRows() : [[button('Главное меню', 'adm:home')]]);
    }
  }
  async function configure() {
    const commands = {
      client: [['start', 'Главное меню'], ['status', 'Статус и срок доступа'], ['site', 'Перейти на сайт'], ['redeem', 'Активировать промокод'], ['terms', 'Условия использования'], ['privacy', 'Обработка данных'], ['help', 'Помощь'], ['id', 'Мой Telegram ID']],
      admin: [['start', 'Панель управления'], ['users', 'Список пользователей'], ['find', 'Поиск пользователя'], ['logs', 'Журнал действий'], ['grant', 'Продлить доступ'], ['block', 'Запретить создание роликов'], ['unblock', 'Разрешить создание роликов'], ['promo', 'Создать промокод на дни доступа'], ['promos', 'Список промокодов'], ['revoke', 'Отозвать промокод'], ['id', 'Мой Telegram ID']],
    };
    if (singleBot) commands.client.push(['admin', 'Панель администратора']);
    for (const type of botTypes) if (tokens[type]) {
      await api(type, 'setMyCommands', { commands: commands[type].map(([command, description]) => ({ command, description })) });
      await api(type, 'setMyDescription', { description: type === 'client' ? 'SCENZA: регистрация, статус доступа и активация промокодов. Работа с проектами — на сайте. 10 токенов в подарок, без автосписаний.' : 'Закрытая панель SCENZA: пользователи, расходы AI, ошибки, доступ, промокоды и обращения. Доступ только для владельца.' });
    }
  }
  async function poll(type, signal) {
    let failures = 0;
    health[type] = { running: true, error: null };
    while (!signal.aborted) {
      let updates;
      try {
        updates = await api(type, 'getUpdates', { offset: offsets[type], timeout: 25, allowed_updates: ['message', 'callback_query'] }, signal);
        if (!Array.isArray(updates)) throw new Error('Неверный ответ Telegram.');
        failures = 0;
        health[type].error = null;
      } catch (error) {
        if (signal.aborted) break;
        if (error.telegramCode === 401) {
          health[type].error = 'Telegram: ошибка 401. Проверьте токен бота.';
          console.error(`SCENZA: Telegram ${type} отклонил токен (401). Получение сообщений остановлено.`);
          break;
        }
        if (error.telegramCode === 409) {
          // Another getUpdates consumer (a local copy or a webhook) holds the bot. Keep retrying instead of going silent forever.
          health[type].error = 'Telegram: ошибка 409 — этот бот одновременно запущен в другом месте. Повторная попытка через 30 секунд.';
          console.error(`SCENZA: Telegram ${type} занят другим процессом (409). Повтор через 30 секунд.`);
          await timers.setTimeout(30000, undefined, { signal }).catch(() => {});
          continue;
        }
        failures = Math.min(failures + 1, 6);
        health[type].error = 'Telegram временно недоступен или вернул некорректный ответ. Повторное подключение автоматически.';
        await timers.setTimeout(Math.min(60, Math.max(error.retryAfter || 0, 2 ** failures)) * 1000, undefined, { signal }).catch(() => {});
        continue;
      }
      let halt = false;
      for (const update of updates) {
        if (signal.aborted) break;
        if (!Number.isSafeInteger(update.update_id) || update.update_id < offsets[type]) continue;
        for (let attempt = 0; attempt < 5 && !signal.aborted; attempt++) {
          try { await handle(type, update); break; }
          catch (error) {
            if (signal.aborted) break;
            if (error.telegramCode === 401) {
              health[type].error = 'Telegram: ошибка 401. Проверьте токен бота.';
              halt = true; break;
            }
            const delivery = error.telegramMethod === 'sendMessage';
            if (delivery && (error.telegramCode === 403 || attempt === 4)) {
              health[type].deliveryFailures = (health[type].deliveryFailures || 0) + 1;
              break;
            }
            if (attempt === 4) {
              // One broken update must not stop the bot for everyone: skip it and keep polling.
              health[type].skippedUpdates = (health[type].skippedUpdates || 0) + 1;
              console.error(`SCENZA: Telegram ${type} пропустил обновление ${update.update_id} после 5 неудачных попыток.`);
              break;
            }
            await timers.setTimeout(Math.min(60, Math.max(error.retryAfter || 0, 2 ** (attempt + 1))) * 1000, undefined, { signal }).catch(() => {});
          }
        }
        if (halt || signal.aborted) break;
        const old = offsets[type];
        offsets[type] = update.update_id + 1;
        try { persist(); }
        catch {
          offsets[type] = old;
          health[type].error = 'Не удалось сохранить позицию Telegram. Повторная попытка через 30 секунд.';
          console.error('SCENZA: не удалось сохранить позицию Telegram. Повтор через 30 секунд.');
          await timers.setTimeout(30000, undefined, { signal }).catch(() => {});
          break;
        }
      }
      if (halt) break;
      if (!updates.length) await timers.setTimeout(100, undefined, { signal }).catch(() => {});
    }
    health[type].running = false;
  }
  async function start() {
    if (starting) return starting;
    starting = (async () => {
      const active = botTypes.filter(type => tokens[type] && !health[type].running);
      for (const type of active) {
        const webhook = await api(type, 'getWebhookInfo');
        if (webhook?.url) throw new Error(`Telegram ${type}: настроен webhook; polling не запущен.`);
      }
      if (!controller || controller.signal.aborted) controller = new AbortController();
      loops.push(...active.map(type => poll(type, controller.signal)));
      if (panel && !notificationTimer) {
        notificationTimer = setInterval(() => { void checkNotifications().catch(() => {}); }, 60000);
        notificationTimer.unref();
      }
    })();
    try { await starting; } finally { starting = null; }
  }
  async function stop() {
    if (starting) await starting.catch(() => {});
    clearInterval(notificationTimer); notificationTimer = null;
    controller?.abort();
    await Promise.allSettled([...loops, notifying]);
    loops = [];
  }
  return { handleClient: update => handle('client', update), handleAdmin: update => handle('admin', update), configure, start, stop, checkNotifications,
    status: () => ({ client: { configured: !!clientToken, ...health.client }, admin: { configured: !!tokens.admin, ...(singleBot ? health.client : health.admin) }, siteReady: !!site, registrationEnabled: !!registrationEnabled }) };
}
