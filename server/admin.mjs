import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const DAY = 86400000;
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const boundedText = (value, max = 3500) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(`Введите текст от 1 до ${max} символов.`);
  return value.trim();
};
const page = (items, { offset = 0, limit = 10 } = {}) => ({ total: items.length, items: items.slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.min(30, Math.max(1, Number(limit) || 10))) });
const sumKnown = (rows, key) => rows.length && rows.every(row => Number.isFinite(row[key])) ? rows.reduce((sum, row) => sum + row[key], 0) : null;
const fingerprint = value => createHash('sha256').update(value).digest('hex');

export async function createAdminService({ auth, dataDir, getVideoApi, now = Date.now, env = process.env, fetch: fetcher = globalThis.fetch }) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'admin.json');
  let state = { maintenance: { enabled: false, message: 'В SCENZA идут технические работы. Новые обработки временно недоступны. Попробуйте позже.' }, tickets: [], broadcasts: [], alerts: {}, events: [] };
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!saved || typeof saved.maintenance?.enabled !== 'boolean' || !Array.isArray(saved.tickets) || !Array.isArray(saved.broadcasts) || !Array.isArray(saved.events) || !saved.alerts || typeof saved.alerts !== 'object') throw new Error('Invalid admin store');
    state = saved;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let writes = Promise.resolve();
  // One backend owns this small settings/support snapshot, like the account store.
  function mutate(change) {
    const operation = writes.then(async () => {
      const next = structuredClone(state), result = change(next);
      const temporary = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      try { await fs.rename(temporary, file); } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
      state = next;
      return structuredClone(result);
    });
    writes = operation.catch(() => {});
    return operation;
  }
  const owner = async actor => { if (await auth.bots.adminRole(actor) !== 'owner') throw fail('Доступ только для владельца.', 403); };
  const accounts = actor => auth.bots.adminSnapshot(actor);
  // Panel taps reuse one snapshot for 15 s instead of re-downloading every project from the database.
  let videoCache = null, videoLoading = null;
  const video = async () => {
    if (videoCache && videoCache.until > now()) return videoCache.value;
    videoLoading ||= (async () => (await getVideoApi()).store.adminSnapshot())()
      .then(value => { videoCache = { value, until: now() + 15000 }; return value; })
      .finally(() => { videoLoading = null; });
    return videoLoading;
  };
  // The minute-by-minute Telegram check reads only active/fresh-failed jobs and fresh AI errors, never project payloads.
  const videoAlerts = async since => { const { store } = await getVideoApi(); return store.alertSnapshot ? store.alertSnapshot({ since }) : store.adminSnapshot(); };
  // The alert names the actual failure so the owner knows whether to wake the database, apply the migration or fix the key.
  const databaseReason = error => {
    const code = error?.code || '';
    if (code === 'VIDEO_DATABASE_UNAVAILABLE') return 'нет связи с Supabase. Проверьте, не приостановлен ли проект в панели Supabase (бесплатные проекты засыпают без активности), и доступ сервера в интернет.';
    if (code === 'VIDEO_TABLE_MISSING') return 'в Supabase нет таблиц видеозадач. Примените server/ai/migration.sql в SQL Editor.';
    if (/^VIDEO_HTTP_(401|403)$/.test(code)) return 'Supabase отклонил ключ (HTTP 401/403). Проверьте SUPABASE_SECRET_KEY на сервере.';
    if (/^VIDEO_HTTP_5\d\d$/.test(code)) return `Supabase вернул ошибку сервера (${code.slice(11)}). Проверьте статус проекта в панели Supabase.`;
    if (code.startsWith('VIDEO_HTTP_')) return `запрос к базе отклонён (HTTP ${code.slice(11)}${error.providerCode ? `, ${error.providerCode}` : ''}). Проверьте применённую миграцию server/ai/migration.sql.`;
    if (/sqlite|database is locked|SQLITE/i.test(error?.message || '')) return 'локальная база SQLite занята или повреждена. Перезапустите сервис.';
    return 'сервис видео не запустился. Проверьте журнал сервера (journalctl -u scenza).';
  };
  const timestamp = () => new Date(now()).toISOString();
  let keyCache, keyRequest;
  async function currentKey() {
    if (keyCache && keyCache.until > now()) return keyCache.value;
    if (keyRequest) return keyRequest;
    keyRequest = (async () => {
      const key = typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY.trim() : '';
      const value = { keyRemaining: null, keyLimit: null, keyStatus: key ? 'unknown' : 'not_configured', keyCheckedAt: timestamp() };
      if (key) {
        try {
          const response = await fetcher('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
          if (!response.ok) value.keyStatus = response.status === 402 ? 'payment_required' : [401, 403].includes(response.status) ? 'disabled' : 'unavailable';
          else {
            const { data } = await response.json();
            if (data?.limit === null && data?.limit_remaining === null) value.keyStatus = 'unlimited';
            else if (Number.isFinite(data?.limit) && data.limit >= 0 && Number.isFinite(data?.limit_remaining)) Object.assign(value, { keyLimit: data.limit, keyRemaining: data.limit_remaining, keyStatus: 'limited' });
          }
        } catch { value.keyStatus = 'unavailable'; }
      }
      keyCache = { until: now() + 5 * 60000, value };
      return value;
    })();
    try { return await keyRequest; } finally { keyRequest = null; }
  }
  const event = (next, type, detail = {}, userId = null) => { next.events.push({ id: randomUUID(), type, userId, at: timestamp(), detail }); next.events = next.events.slice(-1000); };
  const periods = (rows, field = 'createdAt') => {
    const start = new Date(now()); start.setUTCHours(0, 0, 0, 0);
    const since = time => rows.filter(row => Date.parse(row[field]) >= time && Date.parse(row[field]) <= now()).length;
    return { total: rows.length, today: since(start.getTime()), week: since(now() - 7 * DAY), month: since(now() - 30 * DAY) };
  };
  const usageSummary = ({ usage = [], jobs = [], usageUnavailable = false }) => {
    usage = usage.filter(row => !row.kind || row.kind === 'ai');
    const start = new Date(now()); start.setUTCHours(0, 0, 0, 0);
    const slice = since => usage.filter(row => Date.parse(row.createdAt) >= since && Date.parse(row.createdAt) <= now());
    const period = rows => ({ requests: rows.length, tokens: sumKnown(rows, 'totalTokens'), cost: sumKnown(rows, 'cost') });
    const cost = sumKnown(usage, 'cost'), processes = new Set(usage.map(row => row.jobId)).size;
    const today = period(slice(start.getTime())), week = period(slice(now() - 7 * DAY)), month = period(slice(now() - 30 * DAY));
    return { ...period(usage), requests: usage.length || null, today, week, month, tokenPeriods: { today: today.tokens, week: week.tokens, month: month.tokens }, costPeriods: { today: today.cost, week: week.cost, month: month.cost }, averageCost: cost === null || !processes ? null : cost / processes, balance: null, allocatedTokens: null, remainingTokens: null, errors: usage.filter(row => row.error).length, aiJobs: jobs.filter(row => ['analyze', 'revise'].includes(row.type)).length, usageUnavailable, accountingSince: usage.length ? usage.reduce((min, row) => row.createdAt < min ? row.createdAt : min, usage[0].createdAt) : null, note: `${usageUnavailable ? 'Учёт usage недоступен: нужна SQL-миграция. ' : ''}Учёт только сохранённых запросов после включения сбора usage. Исторические токены, лимиты и баланс API неизвестны. Стоимость — USD, только если её вернул API.` };
  };
  const ticketById = (next, id) => { const ticket = next.tickets.find(item => item.id === id); if (!ticket) throw fail('Обращение не найдено.', 404); return ticket; };
  async function createTicket(user, text, eventKey) {
    if (!user?.id) throw fail('Сначала войдите в аккаунт SCENZA.', 403);
    text = boundedText(text);
    const key = eventKey ? fingerprint(`${user.id}:${boundedText(eventKey, 200)}`) : null;
    return mutate(next => {
      const existing = key && next.tickets.find(item => item.eventKey === key);
      if (existing) return existing;
      if (next.tickets.filter(item => item.userId === user.id && Date.parse(item.createdAt) > now() - 10 * 60000).length >= 3) throw fail('Слишком много обращений. Подождите 10 минут.', 429);
      const ticket = { id: randomUUID(), userId: user.id, name: user.name || '', email: user.email || null, telegramUserId: user.telegramUserId || null, text, createdAt: timestamp(), updatedAt: timestamp(), status: 'new', replies: [], eventKey: key };
      next.tickets.push(ticket);
      return ticket;
    });
  }
  async function recipients(actor, audience) {
    if (!['all', 'active', 'access', 'expired', 'blocked'].includes(audience)) throw fail('Неизвестная аудитория.');
    const { users } = await accounts(actor);
    return [...new Set(users.filter(user => user.telegramUserId && (audience === 'all' || audience === 'active' && Date.parse(user.lastActiveAt || user.lastActivityAt) > now() - 30 * DAY || audience === 'access' && user.accessActive || audience === 'expired' && !user.accessActive || audience === 'blocked' && user.blocked)).map(user => user.telegramUserId))];
  }
  const service = {
    async statistics(actor) {
      await owner(actor);
      const [{ users }, data] = await Promise.all([accounts(actor), video().catch(() => null)]);
      if (!data) return { users: { ...periods(users), new: periods(users), active: users.filter(user => Date.parse(user.lastActiveAt || user.lastActivityAt) > now() - 30 * DAY).length, withAccess: users.filter(user => user.accessActive).length }, generations: { total: null, today: null, week: null, month: null, successful: null, failed: null }, ai: { tokens: null, cost: null }, dataUnavailable: true, note: 'База видеозадач недоступна; показатели генераций и AI неизвестны.' };
      const videos = periods(data.projects.flatMap(project => project.clips)), successful = data.jobs.filter(job => job.status === 'done').length, failed = data.jobs.filter(job => job.status === 'error' && job.stage !== 'cancelled').length;
      return { users: { ...periods(users), new: periods(users), active: users.filter(user => Date.parse(user.lastActiveAt || user.lastActivityAt) > now() - 30 * DAY).length, withAccess: users.filter(user => user.accessActive).length, activeDefinition: 'Активность за последние 30 дней; дни статистики в UTC.' }, videos, generations: { ...videos, successful, failed }, jobs: { total: data.jobs.length, successful, errors: failed }, ai: usageSummary(data) };
    },
    async user(actor, id) {
      await owner(actor);
      const [{ users, events }, data] = await Promise.all([accounts(actor), video()]);
      const user = users.find(item => item.id === id); if (!user) throw fail('Пользователь не найден.', 404);
      const jobs = data.jobs.filter(item => item.ownerId === id);
      return { ...user, videos: data.projects.filter(project => project.ownerId === id).flatMap(project => project.clips).length, successful: jobs.filter(job => job.status === 'done').length, errors: jobs.filter(job => job.status === 'error' && job.stage !== 'cancelled').length, ai: usageSummary({ usage: data.usage.filter(item => item.ownerId === id), jobs }), history: events.filter(item => item.userId === id).slice(-10).reverse() };
    },
    async problems(actor, options = {}) { await owner(actor); return page((await video()).jobs.filter(job => job.status === 'error' || job.stalled), options); },
    async job(actor, id) { await owner(actor); const job = (await video()).jobs.find(item => item.id === id); if (!job) throw fail('Задача не найдена.', 404); return job; },
    async jobAction(actor, id, action) {
      await owner(actor); if (action === 'retry') service.assertGenerationAllowed();
      const result = await (await getVideoApi()).store.adminJobAction(id, action);
      videoCache = null;
      await mutate(next => { event(next, `job.${action}`, { jobId: id }); return true; }); return result;
    },
    async aiUsage(actor) { await owner(actor); const [data, key] = await Promise.all([video().catch(() => null), currentKey()]); return { ...usageSummary(data || {}), ...(!data ? { note: 'База видеозадач недоступна; исторические показатели AI прочитать не удалось.' } : {}), ...key, dataUnavailable: !data, keyNote: 'Остаток лимита текущего API-ключа в USD; общий баланс аккаунта API неизвестен. Обновляется не чаще раза в 5 минут.' }; },
    async health(actor) {
      await owner(actor);
      const checks = [{ name: 'backend', status: 'ok', detail: 'Админ-запрос обработан backend.' }];
      try {
        const data = await video();
        checks.push({ name: 'database', status: 'ok', detail: 'Запрос таблиц проектов, задач и usage выполнен.' });
        if (data.usageUnavailable) { checks.at(-1).detail = 'Таблицы проектов и задач доступны.'; checks.push({ name: 'accounting', status: 'warning', detail: 'Таблица usage отсутствует. Примените расширение SQL-миграции; обработка видео продолжает работать.' }); }
        const stalled = data.jobs.filter(job => job.stalled).length;
        checks.push({ name: 'queue', status: stalled ? 'warning' : 'ok', detail: `Зависших задач: ${stalled}. В очереди: ${data.jobs.filter(job => job.status === 'queued').length}.` });
        const live = data.jobs.some(job => job.status === 'running' && !job.stalled);
        checks.push({ name: 'worker', status: live ? 'ok' : stalled ? 'warning' : 'unknown', detail: live ? 'Есть задача с действующей арендой worker.' : 'Нет действующей задачи; наличие процесса независимо не проверено.' });
        const latest = data.usage.filter(row => Date.parse(row.createdAt) > now() - 15 * 60000).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        checks.push({ name: 'ai', status: latest ? latest.error ? 'warning' : 'ok' : 'unknown', detail: latest ? `Последний сохранённый запрос: ${latest.createdAt}${latest.error ? ` (${latest.error})` : ''}.` : 'Нет свежих запросов API; доступность не подтверждена.' });
      } catch { checks.push({ name: 'database', status: 'error', detail: 'Не удалось прочитать базу видеозадач. Проверьте подключение и SQL-миграцию.' }); }
      try { await fs.access(dataDir, constants.R_OK | constants.W_OK); checks.push({ name: 'dataDirectory', status: 'ok', detail: 'Каталог данных доступен для чтения и записи.' }); }
      catch { checks.push({ name: 'dataDirectory', status: 'error', detail: 'Каталог данных недоступен.' }); }
      checks.push({ name: 'site', status: 'unknown', detail: 'Внешняя доступность сайта не проверялась.' }, { name: 'storage', status: 'unknown', detail: 'Чтение пользовательских файлов не выполнялось; доступность облачного хранилища не подтверждена.' });
      const labels = { backend: 'Backend', database: 'База данных', accounting: 'Учёт расходов AI', queue: 'Очередь', worker: 'Обработчик видео', ai: 'AI API', dataDirectory: 'Каталог данных', site: 'Сайт', storage: 'Хранилище' };
      return { checks, components: Object.fromEntries(checks.map(check => [check.name, { label: labels[check.name], status: check.status, message: check.detail }])), maintenance: structuredClone(state.maintenance), checkedAt: timestamp() };
    },
    async maintenance(actor) { await owner(actor); return structuredClone(state.maintenance); },
    async setMaintenance(actor, enabled, message) {
      await owner(actor); if (typeof enabled !== 'boolean') throw fail('Некорректное состояние техработ.');
      if (message !== undefined) message = boundedText(message, 500);
      return mutate(next => { Object.assign(next.maintenance, { enabled, updatedAt: timestamp(), ...(message ? { message } : {}) }); event(next, enabled ? 'maintenance.start' : 'maintenance.end'); return next.maintenance; });
    },
    assertGenerationAllowed() { if (state.maintenance.enabled) throw fail(state.maintenance.message, 503, 'MAINTENANCE'); },
    async createSupport(telegramId, text, eventKey) { return createTicket(await auth.bots.userByTelegram(String(telegramId)), text, eventKey); },
    async createSupportForUser(userId, text, eventKey) { return createTicket(await auth.bots.user(userId), text, eventKey); },
    async userSupport(userId) { return structuredClone(state.tickets.filter(item => item.userId === userId).slice(-30).reverse()); },
    async support(actor, options = {}) { await owner(actor); if (options.id) return structuredClone(ticketById(state, options.id)); return page(structuredClone(state.tickets.filter(item => !options.status || item.status === options.status).slice().reverse()), options); },
    async ticket(actor, id) { await owner(actor); const ticket = structuredClone(ticketById(state, id)); return { ...ticket, reply: ticket.replies.at(-1)?.text || null }; },
    async replySupport(actor, id, text, eventKey) {
      await owner(actor); text = boundedText(text);
      return mutate(next => { const ticket = ticketById(next, id); if (eventKey && ticket.replies.some(reply => reply.eventKey === eventKey)) return ticket; ticket.replies.push({ id: randomUUID(), text, createdAt: timestamp(), ...(eventKey ? { eventKey } : {}) }); ticket.status = 'answered'; ticket.updatedAt = timestamp(); event(next, 'support.reply', { ticketId: id }, ticket.userId); return ticket; });
    },
    async closeSupport(actor, id) { await owner(actor); return mutate(next => { const ticket = ticketById(next, id); ticket.status = 'closed'; ticket.updatedAt = timestamp(); return ticket; }); },
    async broadcastAudience(actor, audience) { await owner(actor); const ids = await recipients(actor, audience); return { audience, recipients: ids, total: ids.length }; },
    async createBroadcast(actor, payload, eventKey) {
      await owner(actor);
      const text = boundedText(payload?.text, payload?.photo ? 1000 : 3500), audience = payload?.audience;
      const photo = payload.photo ? boundedText(payload.photo, 500) : null;
      let button = null;
      if (payload.button) { const label = boundedText(payload.button.text, 60), url = new URL(boundedText(payload.button.url, 500)); if (url.protocol !== 'https:' || url.username || url.password) throw fail('Кнопка должна вести на HTTPS-адрес.'); button = { text: label, url: url.href }; }
      const ids = await recipients(actor, audience);
      const key = eventKey ? fingerprint(boundedText(eventKey, 200)) : null;
      return mutate(next => { const existing = key && next.broadcasts.find(item => item.eventKey === key); if (existing) return existing; const draft = { id: randomUUID(), audience, text, photo, button, recipients: Object.fromEntries(ids.map(id => [id, 'pending'])), createdAt: timestamp(), eventKey: key }; next.broadcasts.push(draft); event(next, 'broadcast.create', { broadcastId: draft.id, audience, count: ids.length }); return draft; });
    },
    async pendingBroadcast(actor, id) { await owner(actor); const draft = state.broadcasts.find(item => item.id === id); if (!draft) throw fail('Рассылка не найдена.', 404); const counts = {}; for (const status of Object.values(draft.recipients)) counts[status] = (counts[status] || 0) + 1; return { ...structuredClone(draft), recipients: Object.keys(draft.recipients).filter(id => draft.recipients[id] === 'pending'), counts }; },
    async recordBroadcast(actor, id, recipient, status) {
      await owner(actor); if (!['sending', 'sent', 'failed', 'unknown'].includes(status)) throw fail('Некорректный статус отправки.');
      return mutate(next => { const draft = next.broadcasts.find(item => item.id === id); if (!draft || !Object.hasOwn(draft.recipients, recipient)) throw fail('Получатель не найден.', 404); const previous = draft.recipients[recipient]; if (status === 'sending' && previous !== 'pending' || status !== 'sending' && previous !== 'sending') return false; draft.recipients[recipient] = status; return true; });
    },
    async claimAlert(actor, key, { cooldownMs = 3600000 } = {}) {
      await owner(actor); const hash = fingerprint(boundedText(key, 2000));
      return mutate(next => { for (const [id, expiry] of Object.entries(next.alerts)) if (expiry <= now()) delete next.alerts[id]; if (next.alerts[hash] > now()) return false; next.alerts[hash] = now() + Math.max(60000, Number(cooldownMs) || 3600000); return true; });
    },
    async releaseAlert(actor, key) { await owner(actor); const hash = fingerprint(boundedText(key, 2000)); return mutate(next => { delete next.alerts[hash]; return true; }); },
    async alerts(actor) {
      await owner(actor);
      const alerts = state.tickets.filter(ticket => ticket.status === 'new').map(ticket => ({ key: `support:${ticket.id}`, text: `Новое обращение SCENZA\n${ticket.name || ticket.userId}\n${ticket.text.slice(0, 2000)}\nID: ${ticket.id}`, cooldownMs: 365 * DAY }));
      const key = await currentKey();
      if (key.keyStatus === 'limited' && key.keyRemaining <= key.keyLimit * 0.1) alerts.push({ key: 'ai:key:low', text: `SCENZA: осталось ${key.keyRemaining} USD из лимита текущего API-ключа ${key.keyLimit} USD. Это лимит ключа, а не общий баланс аккаунта OpenRouter. Проверьте лимиты и баланс в кабинете API.` });
      else if (key.keyStatus === 'payment_required') alerts.push({ key: 'ai:key:payment_required', text: 'SCENZA: OpenRouter вернул HTTP 402 при проверке ключа. Проверьте средства и лимиты в кабинете API.' });
      else if (key.keyStatus === 'disabled') alerts.push({ key: 'ai:key:disabled', text: 'SCENZA: OpenRouter отклонил доступ к текущему API-ключу (HTTP 401/403). Проверьте активность ключа и ограничения доступа.' });
      else if (key.keyStatus === 'unavailable') alerts.push({ key: 'ai:key:unavailable', text: 'SCENZA: проверка лимита OpenRouter API недоступна. Проверьте состояние API и соединение сервера.' });
      try {
        const data = await videoAlerts(new Date(now() - 15 * 60000).toISOString());
        for (const job of data.jobs) {
          if (job.stalled) alerts.push({ key: `job:stalled:${job.type}`, text: `SCENZA: зависшая задача ${job.id}.\nЭтап: ${job.stage}.\nПроверьте раздел «Генерации».` });
          else if (job.status === 'error' && job.stage !== 'cancelled' && Date.parse(job.updatedAt) > now() - 15 * 60000 && /AI|OpenRouter|API|worker|ffmpeg|прерван|недоступ|сервер|timeout|failed/i.test(job.error || '')) alerts.push({ key: `job:error:${job.type}:${String(job.error).slice(0, 500)}`, text: `SCENZA: ошибка обработки ${job.id}.\n${String(job.error).slice(0, 1500)}` });
        }
        const recent = data.usage.filter(row => row.error && Date.parse(row.createdAt) > now() - 15 * 60000);
        for (const code of new Set(recent.map(row => row.error))) if (/NETWORK|PROVIDER|RATE_LIMIT|UNKNOWN|PAYMENT_REQUIRED/.test(code)) alerts.push({ key: `ai:${code}`, text: `SCENZA: сбой AI API (${code}). Проверьте раздел AI / расходы и баланс в кабинете API.` });
      } catch (error) { alerts.push({ key: `database:unavailable:${error?.code || 'unknown'}`, text: `SCENZA: база видеозадач недоступна.\nПричина: ${databaseReason(error)}` }); }
      return alerts;
    },
    async journal(actor, { userId, limit = 20, errorsOnly = false } = {}) {
      await owner(actor);
      const { events } = await accounts(actor), data = await video().catch(() => null);
      const failures = data ? data.jobs.filter(job => job.status === 'error' && job.stage !== 'cancelled').map(job => ({ type: 'job.error', at: job.updatedAt, userId: job.ownerId, detail: { jobId: job.id, error: job.error } })) : [{ type: 'database.error', at: timestamp(), message: 'База видеозадач недоступна. События аккаунтов доступны; ошибки генераций прочитать не удалось.' }];
      return [...events, ...state.events, ...failures].filter(item => (!userId || item.userId === userId) && (!errorsOnly || /error|fail|rejected|critical/.test(item.type || item.event || ''))).map(item => ({ ...item, event: item.event || item.type, message: item.message || item.detail?.error || item.detail?.reason || '' })).sort((a, b) => String(b.at || b.createdAt).localeCompare(String(a.at || a.createdAt))).slice(0, Math.min(50, Math.max(1, Number(limit) || 20)));
    },
    async payments(actor) { await owner(actor); return { configured: false, items: [], message: 'Платёжная система пока не подключена. Истории транзакций и автоматической активации по оплате пока нет.' }; },
  };
  return service;
}
