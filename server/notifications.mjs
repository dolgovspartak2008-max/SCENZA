import { promises as fs } from 'node:fs';
import path from 'node:path';

// Notifications are derived from records that already exist (token ledger, video projects, account audit log),
// so the API and the separate video worker never have to write them. Only the "read up to" time is stored here.
const tokenTitles = {
  trial: 'Стартовые токены', purchase: 'Токены пополнены', grant: 'Начисление от администратора', referral: 'Реферальный бонус',
  promo: 'Промокод активирован', refund: 'Возврат токенов', bonus: 'Бонус за публикацию', analysis: 'Списание токенов',
};
const plural = (count, one, few, many) => count % 10 === 1 && count % 100 !== 11 ? one : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? few : many;
const tokensText = count => `${count} ${plural(Math.abs(count), 'токен', 'токена', 'токенов')}`;
const latest = values => values.filter(Boolean).sort().at(-1);

export function buildNotifications({ tokens = [], projects = [], events = [], support = [], title = project => project.title || 'Проект' }) {
  const items = [];
  for (const entry of tokens) {
    if (!entry?.createdAt || !Number.isFinite(entry.tokens) || !entry.tokens) continue;
    const positive = entry.tokens > 0;
    items.push({
      id: `token:${entry.id}`, kind: positive ? 'tokens' : 'charge', createdAt: entry.createdAt,
      title: tokenTitles[entry.reason] || (positive ? 'Начисление токенов' : 'Списание токенов'),
      text: positive ? `+${tokensText(entry.tokens)} на баланс.${entry.reason === 'grant' && entry.note ? ` ${entry.note}` : ''}` : `−${tokensText(-entry.tokens)} за анализ видео${entry.note ? ` (${entry.note})` : ''}.`,
      ...(entry.projectId && entry.projectId !== '-' ? { link: `/app/ai/${entry.projectId}` } : {}),
    });
  }
  for (const project of projects) {
    const name = title(project), link = `/app/ai/${project.id}`;
    const ready = (project.candidates || []).filter(item => item.ready);
    const readyAt = latest(ready.map(item => item.createdAt)) || (ready.length ? project.analyzedAt : null);
    if (readyAt) items.push({ id: `clips:${project.id}:${ready.length}`, kind: 'video', createdAt: readyAt, title: 'Ролики готовы', text: `${name}: AI нашёл и смонтировал ${ready.length} ${plural(ready.length, 'ролик', 'ролика', 'роликов')}.`, link });
    for (const version of project.versions || []) if (version.createdAt) items.push({ id: `version:${version.id}`, kind: 'video', createdAt: version.createdAt, title: 'Видео смонтировано', text: `${name}: версия ${version.number || 1} готова к просмотру${version.ad ? ' — с вашим баннером' : ''}.`, link });
    for (const item of project.exports || []) if (item.createdAt) items.push({ id: `export:${item.id}`, kind: 'video', createdAt: item.createdAt, title: 'Итоговое видео готово', text: `${name}: MP4 можно посмотреть и скачать.`, link });
    for (const [key, pack] of Object.entries(project.capcutPacks || {})) if (pack?.createdAt) items.push({ id: `pack:${pack.fileId || key}`, kind: 'video', createdAt: pack.createdAt, title: 'Пакет для монтажа готов', text: `${name}: архив для CapCut, Premiere Pro и DaVinci собран.`, link });
    if (project.status === 'FAILED' && project.updatedAt) items.push({ id: `failed:${project.id}:${project.updatedAt}`, kind: 'error', createdAt: project.updatedAt, title: 'Обработка остановлена', text: `${name}: ${project.error || 'не удалось завершить обработку.'} Видео сохранено — повторите обработку в проекте.`, link });
  }
  for (const event of events) {
    const detail = event.detail || {}, at = event.at;
    if (!at) continue;
    const add = (title, text, kind = 'admin') => items.push({ id: `event:${event.event}:${at}`, kind, createdAt: at, title, text });
    if (event.event === 'access.grant') add('Доступ продлён', `Администратор продлил доступ на ${detail.days} ${plural(Number(detail.days) || 0, 'день', 'дня', 'дней')}.`);
    else if (event.event === 'account.block') add('Создание роликов приостановлено', `Администратор ограничил обработку видео.${detail.reason ? ` Причина: ${detail.reason}` : ''} Вход и ваши файлы доступны.`, 'error');
    else if (event.event === 'account.unblock') add('Ограничение снято', 'Администратор снова разрешил создание роликов.');
    else if (event.event === 'account.role') add('Роль изменена', `Администратор изменил роль аккаунта: ${detail.role === 'support' ? 'поддержка' : 'пользователь'}.`);
    else if (event.event === 'plan.activate') add('Тариф активирован', `Тариф ${String(detail.plan || '').toUpperCase()} подключён${detail.tokens ? `, начислено ${tokensText(Number(detail.tokens))}` : ''}.`);
    else if (event.event === 'promo.redeem') add('Промокод применён', `Доступ продлён на ${detail.days} ${plural(Number(detail.days) || 0, 'день', 'дня', 'дней')}.`, 'tokens');
    else if (event.event === 'login') add('Вход в аккаунт', `Выполнен вход через ${detail.provider === 'telegram' ? 'Telegram' : 'email'}. Если это были не вы, смените пароль и напишите в поддержку.`, 'security');
    else if (event.event === 'password.reset') add('Пароль изменён', 'Пароль аккаунта был сброшен. Если это были не вы, напишите в поддержку.', 'security');
  }
  for (const ticket of support) for (const reply of ticket.replies || []) {
    if (!reply?.createdAt) continue;
    const text = String(reply.text || '').replace(/\s+/g, ' ').trim();
    items.push({ id: `support:${reply.id || reply.createdAt}`, kind: 'support', createdAt: reply.createdAt, title: 'Ответ поддержки', text: text.length > 220 ? `${text.slice(0, 220)}…` : text, action: 'support' });
  }
  const seen = new Set();
  return items.filter(item => !seen.has(item.id) && seen.add(item.id)).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, 60);
}

export function createNotificationState(dataDir) {
  const file = path.join(dataDir, 'notifications-read.json');
  let state = null, queue = Promise.resolve();
  const load = async () => {
    if (state) return state;
    try { const value = JSON.parse(await fs.readFile(file, 'utf8')); state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { state = {}; }
    return state;
  };
  return {
    async readAt(userId) { return (await load())[userId] || null; },
    markRead(userId, at = new Date().toISOString()) {
      queue = queue.then(async () => {
        const current = await load();
        current[userId] = at;
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(`${file}.tmp`, JSON.stringify(current), { mode: 0o600 });
        await fs.rename(`${file}.tmp`, file);
      });
      return queue;
    },
  };
}
