import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function createHealthWatch({ siteUrl, botToken, ownerTelegramId, fetch = globalThis.fetch, now = Date.now, signal }) {
  let site;
  try {
    site = new URL(siteUrl);
    if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error();
  } catch { throw new Error('Укажите корневой HTTPS-адрес SCENZA без пароля и параметров.'); }
  if (typeof botToken !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(botToken)) throw new Error('Проверьте токен Telegram-бота.');
  if (!/^\d{1,16}$/.test(String(ownerTelegramId))) throw new Error('Укажите Telegram ID владельца.');
  let failures = 0, alerted = false, lastNotification, nextAttempt = 0, running;
  const requestSignal = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  async function probe(api) {
    try {
      const response = await fetch(`${site.origin}${api ? '/api/health/ready' : '/'}`, { redirect: 'error', cache: 'no-store', signal: requestSignal() });
      if (api && response.ok) return (await response.json()).ok === true;
      const ok = response.ok && /\btext\/html\b/i.test(response.headers.get('content-type') || '');
      await response.body?.cancel();
      return ok;
    } catch { return false; }
  }
  async function notify(kind, checks) {
    lastNotification = kind; nextAttempt = now() + 5 * 60000;
    const text = kind === 'recovery'
      ? `SCENZA: сайт и API снова доступны.\n${site.origin}`
      : `SCENZA: три проверки подряд завершились сбоем.\nСайт: ${checks.site ? 'доступен' : 'недоступен'}. API: ${checks.backend ? 'доступен' : 'недоступен'}.\n${site.origin}\nПроверьте сервер и подключение.`;
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', redirect: 'error', signal: requestSignal(), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(ownerTelegramId), text }),
      });
      if (!response.ok) { await response.body?.cancel(); return 'failed'; }
      if ((await response.json()).ok !== true) return 'failed';
      alerted = kind === 'outage';
      return kind;
    } catch { return 'failed'; }
  }
  async function tick() {
    if (signal?.aborted) return { stopped: true };
    const [siteOk, backend] = await Promise.all([probe(false), probe(true)]);
    if (signal?.aborted) return { stopped: true };
    const checks = { site: siteOk, backend }, ok = siteOk && backend;
    failures = ok ? 0 : failures + 1;
    const kind = ok && alerted ? 'recovery' : !ok && failures >= 3 && !alerted ? 'outage' : null;
    const notification = kind && (lastNotification !== kind || now() >= nextAttempt) ? await notify(kind, checks) : null;
    return { ok, checks, consecutiveFailures: failures, notification };
  }
  return { check() { return running ??= tick().finally(() => { running = null; }); } };
}

async function main() {
  const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const configPath = path.resolve(process.env.SCENA_BOT_CONFIG || path.join(workspace, '.scena', 'bot-secrets.json'));
  const stat = await fs.stat(configPath);
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('Проверьте права файла подключения.');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const controller = new AbortController();
  const stop = () => controller.abort();
  const watch = createHealthWatch({ siteUrl: process.env.SCENA_PUBLIC_ORIGIN, botToken: process.env.SCENA_BOT_TOKEN || config.clientToken, ownerTelegramId: config.ownerTelegramIds?.[0], signal: controller.signal });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log('SCENZA: внешний монитор запущен. Проверка сайта и API каждую минуту.');
  try {
    while (!controller.signal.aborted) {
      const started = Date.now();
      const result = await watch.check();
      if (result.notification === 'failed') console.error('SCENZA: Telegram не подтвердил уведомление монитора. Повтор не раньше чем через 5 минут.');
      await delay(Math.max(0, 60000 - (Date.now() - started)), undefined, { signal: controller.signal });
    }
  } catch (error) { if (!controller.signal.aborted) throw error; }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('SCENZA: монитор не запущен. Проверьте SCENA_PUBLIC_ORIGIN, SCENA_BOT_TOKEN и закрытый файл SCENA_BOT_CONFIG.');
    process.exitCode = 1;
  });
}
