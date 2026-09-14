import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createVite } from 'vite';
import { createServer } from '../server/index.mjs';
import { createTelegramBots } from '../server/telegram-bots.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(workspace, '.scena', 'service');
const lockPath = path.join(dataDir, 'runtime.lock');
let backend, frontend, bots, lock, healthTimer;
let stage = 'чтение закрытого файла подключения';
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(healthTimer);
  await bots?.stop();
  await frontend?.close();
  if (backend?.listening) await new Promise(resolve => backend.close(resolve));
  await backend?.auth?.flush?.();
  if (lock) await fs.writeFile(path.join(dataDir, 'status.json'), JSON.stringify({ running: false, stoppedAt: new Date().toISOString() }), { mode: 0o600 }).catch(() => {});
  if (lock) { await lock.close(); await fs.unlink(lockPath).catch(() => {}); }
}

try {
  const config = JSON.parse(await fs.readFile(path.join(workspace, '.scena', 'bot-secrets.json'), 'utf8'));
  if (process.argv.includes('--token-stdin')) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 200) throw new Error('Некорректный токен.');
    }
    config.clientToken = input.trim();
  }
  if (typeof config.clientToken !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(config.clientToken)) throw new Error('Проверьте токен SCENZA_BOT.');
  if (!Array.isArray(config.ownerTelegramIds) || !config.ownerTelegramIds.length || config.ownerTelegramIds.some(id => !/^\d{1,16}$/.test(String(id)))) throw new Error('Укажите личный числовой Telegram ID владельца.');
  let siteUrl = '';
  if (config.siteUrl) {
    const url = new URL(config.siteUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) throw new Error('Нужен публичный HTTPS-адрес сайта.');
    siteUrl = url.origin;
  }
  await fs.mkdir(dataDir, { recursive: true });
  stage = 'проверка единственного экземпляра сервиса';
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Сервис уже запущен или остался файл runtime.lock. Второй экземпляр не запускается.'); }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const origins = ['http://127.0.0.1:5183', 'http://localhost:5183'];
  stage = 'открытие хранилища аккаунтов';
  backend = await createServer({ dataDir, seed: false, allowLocalStudio: false, authOptions: {
    ownerTelegramIds: config.ownerTelegramIds.map(String), botRegistrationEnabled: config.registrationEnabled === true,
    legalReady: config.legalReady === true, telegramClientId: siteUrl && config.websiteLoginEnabled === true ? config.clientToken.split(':')[0] : '',
    telegramBotUsername: 'SCENZA_BOT',
    telegramBotToken: config.clientToken,
    allowedOrigins: origins,
  } });
  bots = createTelegramBots({ clientToken: config.clientToken, adminToken: config.adminToken, service: backend.auth.bots, siteUrl, registrationEnabled: config.registrationEnabled === true, stateFile: path.join(dataDir, 'telegram-offsets.json') });
  stage = 'запуск локального API на порту 5184';
  await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(5184, '127.0.0.1', resolve); });
  frontend = await createVite({ root: workspace, server: { host: '127.0.0.1', port: 5183, strictPort: true, proxy: { '/api': 'http://127.0.0.1:5184', '/media': 'http://127.0.0.1:5184', '/downloads': 'http://127.0.0.1:5184' } } });
  stage = 'запуск локального сайта на порту 5183';
  await frontend.listen();
  stage = 'настройка команд и описаний в Telegram';
  await bots.configure();
  stage = 'подключение получения сообщений Telegram';
  await bots.start();
  let lastHealth = '';
  const writeHealth = async () => {
    const status = bots.status();
    const current = JSON.stringify(status);
    if (current === lastHealth) return;
    lastHealth = current;
    await fs.writeFile(path.join(dataDir, 'status.json'), JSON.stringify({ running: true, pid: process.pid, updatedAt: new Date().toISOString(), ...status }), { mode: 0o600 });
    if (!status.client.running) console.error('SCENZA: бот остановил получение сообщений. Проверьте статус сервиса и подключение.');
  };
  await writeHealth();
  healthTimer = setInterval(() => { void writeHealth().catch(() => console.error('SCENZA: не удалось сохранить статус сервиса.')); }, 10000);
  healthTimer.unref();
  console.log(`SCENZA: ${config.adminToken && config.adminToken !== config.clientToken ? 'клиентский и административный боты запущены' : 'единый бот запущен, панель владельца: /admin'}. Локальный сайт: http://127.0.0.1:5183.`);
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
} catch (error) {
  // Never print a Telegram request error: its URL can contain a bot token.
  console.error('SCENZA: запуск ботов не завершён. Проверьте закрытый файл подключения, доступность Telegram и порты 5183/5184.');
  console.error(`Этап: ${stage}.`);
  if (error?.code === 'EADDRINUSE') console.error('Порт занят другим процессом. Текущие процессы не остановлены.');
  await stop();
  process.exitCode = 1;
}
