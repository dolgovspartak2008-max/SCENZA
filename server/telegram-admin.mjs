import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const button = (text, callback_data) => ({ text, callback_data });
const back = [button('Главное меню', 'adm:home')];
const textValue = value => String(value ?? '—').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 700);
const date = value => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК' : '—';
const amount = value => value == null ? 'нет данных' : Number(value).toLocaleString('ru-RU');
const period = values => `сегодня / 7 дней / 30 дней: ${amount(values?.today)} / ${amount(values?.week)} / ${amount(values?.month)}`;

export function createTelegramAdmin({ service, send, api, sendPhoto, complete, now = Date.now }) {
  const waiting = new Map(), confirmations = new Map();
  const panel = service.panel;
  const reply = (id, text, rows = []) => send('admin', id, text, [...rows, back]);
  const done = (id, eventKey, text) => complete('admin', id, eventKey, text, [back]);
  const ask = (id, kind, text, values = {}) => {
    waiting.set(id, { kind, ...values, expires: now() + 10 * 60000 });
    return reply(id, text, [[button('Отмена', 'adm:cancel')]]);
  };
  function confirm(id, action, values, description) {
    for (const [key, entry] of confirmations) if (entry.expires <= now()) confirmations.delete(key);
    const token = randomBytes(12).toString('hex');
    confirmations.set(token, { id, action, values, expires: now() + 300000 });
    return reply(id, description, [[button('Подтвердить', `adm:confirm:${token}`), button('Отмена', 'adm:cancel')]]);
  }
  const hasPending = id => waiting.has(id) && waiting.get(id).expires > now();
  async function home(id) {
    const maintenance = await panel.maintenance(id);
    return send('admin', id, `SCENZA · панель владельца${maintenance.enabled ? '\nТЕХРАБОТЫ ВКЛЮЧЕНЫ — новые обработки приостановлены.' : ''}\nВыберите раздел.`, [
      [button('Статистика', 'adm:stats'), button('Пользователи', 'users:0')],
      [button('Генерации', 'adm:jobs:0'), button('Платежи', 'adm:payments')],
      [button('AI / расходы', 'adm:ai'), button('Промокоды', 'promos')],
      [button('Рассылка', 'adm:broadcast'), button('Ошибки', 'adm:errors')],
      [button('Состояние системы', 'adm:health'), button('Обращения', 'adm:support:new:0')],
      [button('Журнал', 'adm:journal'), button('Техработы', 'adm:maintenance')],
    ]);
  }
  async function previewBroadcast(id, draft) {
    const recipients = await panel.broadcastAudience(id, draft.audience);
    const count = Array.isArray(recipients) ? recipients.length : recipients.total;
    const rows = draft.button ? [[{ text: draft.button.text, url: draft.button.url }]] : [];
    if (draft.photo) await api('admin', 'sendPhoto', { chat_id: id, photo: draft.photo, caption: draft.text, ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) });
    else await send('admin', id, draft.text, rows);
    return confirm(id, 'broadcast', draft, `Предпросмотр рассылки выше. Получателей: ${count}.\nОтправить это сообщение?`);
  }
  async function execute(id, entry, eventKey) {
    const v = entry.values;
    if (entry.action === 'maintenance') await panel.setMaintenance(id, v.enabled, 'В SCENZA проводятся технические работы. Новые обработки временно недоступны.');
    else if (entry.action === 'block') await service.block(id, v.userId, true, eventKey, v.reason);
    else if (entry.action === 'job') await panel.jobAction(id, v.id, v.action);
    else if (entry.action === 'deletePromo') await service.deletePromo(id, v.id, eventKey);
    else if (entry.action === 'createPromo') {
      const result = await service.createPromo(id, v.days, v.uses, eventKey, v.options);
      return done(id, eventKey, `Промокод: ${result.code}\nБонус: ${result.days} дней доступа\nАктиваций: ${result.maxUses}\nДействует до: ${date(result.expiresAt)}\nСохраните код: повторно он не показывается.`);
    } else if (entry.action === 'broadcast') {
      const campaign = await panel.createBroadcast(id, v, eventKey);
      const pending = await panel.pendingBroadcast(id, campaign.id);
      let sent = 0, failed = 0, unknown = 0;
      for (const recipient of pending.recipients) {
        if (await service.adminRole(id) !== 'owner') break;
        const chatId = String(recipient.telegramUserId ?? recipient);
        if (!await panel.recordBroadcast(id, campaign.id, chatId, 'sending')) continue;
        const markup = v.button ? { reply_markup: { inline_keyboard: [[{ text: v.button.text, url: v.button.url }]] } } : {};
        try {
          if (v.photo) await sendPhoto(chatId, v, markup);
          else await api('client', 'sendMessage', { chat_id: chatId, text: v.text, ...markup });
          await panel.recordBroadcast(id, campaign.id, chatId, 'sent'); sent++;
        } catch (error) {
          const status = error.telegramCode ? 'failed' : 'unknown';
          await panel.recordBroadcast(id, campaign.id, chatId, status);
          if (status === 'failed') failed++; else unknown++;
          if ([401, 429].includes(error.telegramCode)) break;
        }
        await delay(60);
      }
      const final = await panel.pendingBroadcast(id, campaign.id);
      return done(id, eventKey, `Рассылка обработана. Доставлено: ${sent}; не доставлено: ${failed}; результат неизвестен: ${unknown}; осталось: ${final.recipients.length}.\nID: ${campaign.id}\nПовторная отправка автоматически не выполняется.`);
    }
    return done(id, eventKey, 'Изменение сохранено.');
  }
  async function handle(id, text, data, eventKey, message = {}) {
    if (await service.adminRole(id) !== 'owner') { await reply(id, 'Доступ к панели не предоставлен.'); return true; }
    if (data === 'adm:home' || data === 'adm:cancel' || text === '/admin') {
      waiting.delete(id);
      for (const [key, entry] of confirmations) if (entry.id === id) confirmations.delete(key);
      await home(id); return true;
    }
    if (data?.startsWith('adm:confirm:')) {
      const token = data.slice(12), entry = confirmations.get(token);
      if (!entry || entry.id !== id || entry.expires <= now()) { await reply(id, 'Подтверждение уже использовано или истекло.'); return true; }
      confirmations.delete(token);
      await execute(id, entry, eventKey); return true;
    }
    if (data?.startsWith('block:') || /^\/block\s/.test(text)) {
      const value = data ? data.slice(6) : text.trim().split(/\s+/)[1];
      const user = await service.user(value);
      await ask(id, 'block', `Укажите причину запрета новых обработок для ${textValue(user.name)}. Вход в аккаунт останется доступен.`, { userId: user.id }); return true;
    }
    if (!data && hasPending(id)) {
      const pending = waiting.get(id);
      if (text.startsWith('/')) { waiting.delete(id); return false; }
      const value = text.trim();
      if (pending.kind === 'block') {
        if (!value || value.length > 500) { await reply(id, 'Причина должна содержать 1–500 символов.'); return true; }
        waiting.delete(id);
        await confirm(id, 'block', { userId: pending.userId, reason: value }, `Запретить новые обработки?\nПричина: ${value}`);
      } else if (pending.kind === 'search') {
        waiting.delete(id);
        const found = await service.users({ query: value, limit: 8 });
        await reply(id, `Найдено: ${found.total}. Уточните запрос, если нужного пользователя нет в первых восьми.`, found.items.map(user => [button(textValue(user.name).slice(0, 45), `user:${user.id}`)]));
      } else if (pending.kind === 'supportReply') {
        if (!value || value.length > 3000) { await reply(id, 'Ответ должен содержать 1–3000 символов.'); return true; }
        const ticket = await panel.replySupport(id, pending.ticketId, value, eventKey);
        waiting.delete(id);
        let delivered = false;
        if (ticket.telegramUserId) {
          try { await send('client', ticket.telegramUserId, `Ответ SCENZA на обращение ${ticket.id}\n\n${value}`); delivered = true; } catch { /* The saved reply remains available on the website. */ }
        }
        await reply(id, `Ответ сохранён в обращении.${delivered ? ' Доставлен в Telegram.' : ' Доступен пользователю на сайте; доставка в Telegram не подтверждена.'}`);
      } else if (pending.kind === 'promo') {
        const [code, days, uses, expires, onlyNew] = value.split(/\s+/);
        if (!code || !/^[A-Z0-9_-]{4,32}$/i.test(code) || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 365 || !Number.isInteger(Number(uses)) || Number(uses) < 1 || Number(uses) > 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(expires || '') || !Number.isFinite(Date.parse(expires)) || Date.parse(expires + 'T23:59:59Z') <= now() || !['все','новые'].includes(onlyNew)) {
          await reply(id, 'Формат: КОД ДНИ АКТИВАЦИИ ГГГГ-ММ-ДД все|новые\nНапример: START 7 100 2027-12-31 все'); return true;
        }
        waiting.delete(id);
        await confirm(id, 'createPromo', { days: Number(days), uses: Number(uses), options: { code, expiresAt: expires + 'T23:59:59Z', newUsersOnly: onlyNew === 'новые' } }, `Создать ${code}: ${days} дней, ${uses} активаций, до ${expires}, ${onlyNew}?\n«Новые»: зарегистрированы за последние 7 дней, без прежних активаций промокодов.`);
      } else if (pending.kind === 'broadcastText') {
        const photo = message.photo?.at(-1)?.file_id;
        const content = photo ? message.caption?.trim() : value;
        if (!content || content.length > (photo ? 1000 : 3500)) { await reply(id, 'Отправьте текст до 3500 символов или фото с подписью до 1000 символов.'); return true; }
        await ask(id, 'broadcastButton', 'Добавьте кнопку: НАЗВАНИЕ | https://адрес\nИли отправьте «без кнопки».', { draft: { audience: pending.audience, text: content, ...(photo ? { photo } : {}) } });
      } else if (pending.kind === 'broadcastButton') {
        let link;
        if (value.toLowerCase() !== 'без кнопки') {
          const [label, address, extra] = value.split('|').map(v => v.trim());
          try {
            const url = new URL(address);
            if (extra || !label || label.length > 60 || url.protocol !== 'https:' || url.username || url.password) throw new Error();
            link = { text: label, url: url.href };
          } catch { await reply(id, 'Нужна кнопка в формате НАЗВАНИЕ | https://адрес или «без кнопки».'); return true; }
        }
        waiting.delete(id);
        await previewBroadcast(id, { ...pending.draft, ...(link ? { button: link } : {}) });
      }
      return true;
    }
    if (!data?.startsWith('adm:')) return false;
    waiting.delete(id);
    const [, section, value, more] = data.split(':');
    if (section === 'stats') {
      const s = await panel.statistics(id);
      await reply(id, `Статистика SCENZA\nПользователей: ${amount(s.users?.total)}\nАктивны за 30 дней: ${amount(s.users?.active)}\nНовые, ${period(s.users?.new)}\nРоликов всего: ${amount(s.generations?.total)}\nСоздано, ${period(s.generations)}\nУспешных обработок: ${amount(s.generations?.successful)}\nОшибок: ${amount(s.generations?.failed)}\nТокенов: ${amount(s.ai?.tokens)}\nРасходы: ${amount(s.ai?.cost)} USD\nРасходы USD, ${period(s.ai?.costPeriods)}\nСредняя стоимость обработки: ${amount(s.ai?.averageCost)} USD\nДни статистики считаются по UTC.`, [[button('AI / расходы', 'adm:ai')]]);
    } else if (section === 'ai') {
      const usage = await panel.aiUsage(id);
      await reply(id, `AI / расходы\nЗапросов: ${amount(usage.requests)}\nТокенов: ${amount(usage.tokens)}\nТокены, ${period(usage.tokenPeriods)}\nСтоимость: ${amount(usage.cost)} USD\nРасходы USD, ${period(usage.costPeriods)}\nСредняя стоимость обработки: ${amount(usage.averageCost)} USD\nОшибки AI: ${amount(usage.errors)}\nОбщий баланс API: ${amount(usage.balance)}\nОстаток лимита API-ключа: ${amount(usage.keyRemaining)} USD\n${usage.note || 'Исторические данные, которые сервис не сохранял, недоступны.'}`);
    } else if (section === 'payments') {
      await reply(id, 'Платежи\nПлатёжная система ещё не подключена. Транзакций нет.\nПосле выбора провайдера здесь появятся пользователь, сумма, продукт, дата, статус и ID транзакции. Автоматическую активацию доступа нужно подключить к проверенному уведомлению об успешной оплате.');
    } else if (section === 'maintenance') {
      if (['on','off'].includes(value)) await confirm(id, 'maintenance', { enabled: value === 'on' }, `${value === 'on' ? 'Включить' : 'Отключить'} технические работы?\nСайт, вход и данные пользователей остаются доступны.`);
      else { const state = await panel.maintenance(id); await reply(id, `Технические работы: ${state.enabled ? 'ВКЛЮЧЕНЫ' : 'выключены'}\n${state.enabled ? textValue(state.message) : 'Новые обработки разрешены при наличии доступа.'}`, [[button(state.enabled ? 'Отключить' : 'Включить', `adm:maintenance:${state.enabled ? 'off' : 'on'}`)]]); }
    } else if (section === 'health') {
      const health = await panel.health(id);
      const entries = health.components || health;
      await reply(id, `Состояние системы\n${Object.entries(entries).map(([name, item]) => `${({ok:'✅',warning:'⚠️',error:'❌',unknown:'⚠️'})[item.status] || '⚠️'} ${item.label || name}: ${textValue(item.message || item.status)}`).join('\n')}\nПроверка на ${date(new Date(now()).toISOString())}`);
    } else if (section === 'jobs') {
      const result = await panel.problems(id, { offset: Number(value) || 0, limit: 6 });
      const rows = result.items.map(job => [button(`${textValue(job.stage)} · ${job.id.slice(0,8)}`, `adm:job:${job.id}`)]);
      const offset = Number(value) || 0;
      if (offset) rows.push([button('Назад', `adm:jobs:${Math.max(0, offset - 6)}`)]);
      if (offset + 6 < result.total) rows.push([button('Далее', `adm:jobs:${offset + 6}`)]);
      await reply(id, `Проблемные генерации: ${result.total}\nОшибки и задачи с истёкшей арендой worker. Видео пользователей здесь не отображаются.`, rows);
    } else if (section === 'job') {
      const job = await panel.job(id, value);
      await reply(id, `Задача ${job.id}\nПользователь: ${job.ownerId}\nТип: ${job.type}\nСтатус: ${job.status}\nЭтап: ${textValue(job.stage)}\nПопыток: ${job.attempts}\nОбновлена: ${date(job.updatedAt)}\nОшибка: ${textValue(job.error)}`, [[button('Повторить', `adm:jobaction:${job.id}:retry`),button('Отменить', `adm:jobaction:${job.id}:cancel`)], [button('Удалить задачу', `adm:jobaction:${job.id}:delete`)], [button('К проблемным', 'adm:jobs:0')]]);
    } else if (section === 'jobaction' && ['retry','cancel','delete'].includes(more)) {
      await confirm(id, 'job', { id: value, action: more }, `${({retry:'Повторить обработку',cancel:'Отменить обработку',delete:'Удалить проблемную задачу'})[more]} ${value}?`);
    } else if (section === 'search') await ask(id, 'search', 'Отправьте имя, email, Telegram ID или ID аккаунта.');
    else if (section === 'promo') await ask(id, 'promo', 'Создание промокода на период доступа.\nОтправьте: КОД ДНИ АКТИВАЦИИ ГГГГ-ММ-ДД все|новые\nПример: START 7 100 2027-12-31 все');
    else if (section === 'deletepromo') await confirm(id, 'deletePromo', { id: value }, 'Удалить промокод? Новые активации станут недоступны, история использования сохранится.');
    else if (section === 'broadcast') {
      if (value) await ask(id, 'broadcastText', 'Отправьте текст рассылки или фото с подписью. Сначала будет показан предпросмотр.', { audience: value });
      else await reply(id, 'Рассылка\nВыберите получателей. Отправка начнётся только после предпросмотра и подтверждения.', [[button('Все в Telegram','adm:broadcast:all'),button('Активные','adm:broadcast:active')],[button('С доступом','adm:broadcast:access'),button('Доступ истёк','adm:broadcast:expired')]]);
    } else if (section === 'support') {
      const result = await panel.support(id, { status: value || 'new', offset: Number(more) || 0, limit: 6 });
      const rows = result.items.map(ticket => [button(`${textValue(ticket.text).slice(0,40)}`, `adm:ticket:${ticket.id}`)]);
      const offset = Number(more) || 0;
      if (offset) rows.push([button('Назад', `adm:support:${value}:${Math.max(0,offset-6)}`)]);
      if (offset + 6 < result.total) rows.push([button('Далее', `adm:support:${value}:${offset+6}`)]);
      rows.push([button('Новые','adm:support:new:0'),button('Отвеченные','adm:support:answered:0'),button('Закрытые','adm:support:closed:0')]);
      await reply(id, `Обращения (${value || 'new'}): ${result.total}`, rows);
    } else if (section === 'ticket') {
      const ticket = await panel.ticket(id, value);
      const answers = ticket.replies?.slice(-3).map(item => `${date(item.createdAt)}: ${textValue(item.text).slice(0,350)}`).join('\n') || ticket.reply || '';
      await reply(id, `Обращение ${ticket.id}\nПользователь: ${textValue(ticket.userId)}\nTelegram: ${textValue(ticket.telegramUserId)}\nEmail: ${textValue(ticket.email)}\nДата: ${date(ticket.createdAt)}\nСтатус: ${ticket.status}\n\n${ticket.text.slice(0,2000)}${ticket.text.length > 2000 ? '\n…текст сокращён' : ''}\n${answers ? '\nПоследние ответы:\n'+answers : ''}`, [[button('Ответить', `adm:reply:${ticket.id}`),button('Закрыть', `adm:close:${ticket.id}`)], ...(ticket.text.length > 2000 ? [[button('Текст целиком', `adm:tickettext:${ticket.id}`)]] : [])]);
    } else if (section === 'tickettext') {
      const ticket = await panel.ticket(id, value);
      await reply(id, `Обращение ${ticket.id}\n\n${ticket.text}`, [[button('К обращению', `adm:ticket:${ticket.id}`)]]);
    } else if (section === 'reply') await ask(id, 'supportReply', 'Напишите ответ пользователю (до 3000 символов).', { ticketId: value });
    else if (section === 'close') { await panel.closeSupport(id, value); await reply(id, 'Обращение закрыто.'); }
    else if (section === 'journal' || section === 'errors') {
      const logs = await panel.journal(id, { limit: 8, errorsOnly: section === 'errors' });
      await reply(id, `${section === 'errors' ? 'Ошибки' : 'Журнал'}\n${logs.map(item => `${date(item.at)} · ${textValue(item.event)}\n${textValue(item.message || item.detail?.reason || '')}`).join('\n\n') || 'Записей нет.'}`, [[button('Проблемные задачи', 'adm:jobs:0')]]);
    } else await home(id);
    return true;
  }
  return { handle, hasPending, home };
}
