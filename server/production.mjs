import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function httpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}: требуется HTTPS origin.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name}: требуется HTTPS origin без пути и авторизации.`);
  return url.origin;
}

export function readProductionConfig(env = process.env, config = {}) {
  const publicOrigin = httpsOrigin(env.SCENA_PUBLIC_ORIGIN, 'SCENA_PUBLIC_ORIGIN');
  const url = httpsOrigin(env.SUPABASE_URL, 'SUPABASE_URL');
  for (const key of ['SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) throw new Error(`${key}: обязательная настройка.`);
  }
  const port = Number(env.SCENA_PORT ?? 5174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SCENA_PORT: требуется порт 1–65535.');
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Некорректная конфигурация Telegram.');
  const dataDir = path.resolve(env.SCENA_DATA_DIR || path.join(workspace, '.scena', 'service'));
  const clientToken = env.SCENA_BOT_TOKEN || config.clientToken;
  if (env.SCENA_BOTS_ENABLED === 'true' && !clientToken) throw new Error('Telegram: подключение включено, но токен SCENZA_BOT не сохранён.');
  const botsEnabled = !!(clientToken || config.adminToken);
  if (botsEnabled) {
    if (typeof clientToken !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(clientToken)) throw new Error('Telegram: нужен корректный токен SCENZA_BOT.');
    if (config.adminToken !== undefined && (typeof config.adminToken !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(config.adminToken))) throw new Error('Telegram: нужен корректный токен админ-бота.');
    if (!Array.isArray(config.ownerTelegramIds) || !config.ownerTelegramIds.length || config.ownerTelegramIds.some(id => !/^\d{1,16}$/.test(String(id)))) throw new Error('Telegram: укажите числовые ID владельцев.');
  }
  return {
    host: '127.0.0.1', port,
    supabase: { url, serviceKey: env.SUPABASE_SECRET_KEY, publicKey: env.SUPABASE_PUBLISHABLE_KEY },
    emailEnabled: env.SCENA_EMAIL_ENABLED === 'true',
    serverOptions: {
      dataDir, seed: false, allowLocalStudio: false, allowedOrigins: [publicOrigin],
      authOptions: {
        secureCookies: true, trustProxy: true, allowedOrigins: [publicOrigin],
        legalReady: env.SCENA_LEGAL_READY === undefined ? config.legalReady === true : env.SCENA_LEGAL_READY === 'true',
        ownerTelegramIds: botsEnabled ? config.ownerTelegramIds.map(String) : [],
        botRegistrationEnabled: botsEnabled && config.registrationEnabled === true,
        telegramClientId: botsEnabled && config.websiteLoginEnabled === true ? clientToken.split(':')[0] : '',
        telegramBotUsername: botsEnabled && env.SCENA_BOTS_ENABLED !== 'false' ? 'SCENZA_BOT' : '',
        telegramBotToken: clientToken,
      },
    },
    botOptions: botsEnabled && env.SCENA_BOTS_ENABLED !== 'false' ? {
      clientToken,
      ...(config.adminToken ? { adminToken: config.adminToken } : {}),
      siteUrl: publicOrigin, registrationEnabled: config.registrationEnabled === true,
      stateFile: path.join(dataDir, 'telegram-offsets.json'),
    } : null,
  };
}

async function main() {
  let backend, bots, stopping;
  let stage = 'проверка настроек';
  const stop = () => stopping ??= (async () => {
    const timeout = setTimeout(() => {
      backend?.closeAllConnections();
    }, 10000);
    timeout.unref();
    try {
      const closed = backend?.listening
        ? new Promise((resolve, reject) => backend.close(error => error ? reject(error) : resolve()))
        : Promise.resolve(backend?.emit('close'));
      await Promise.all([bots?.stop(), closed]);
      await backend?.auth?.flush?.();
    } finally { clearTimeout(timeout); }
  })();
  try {
    const configPath = path.resolve(process.env.SCENA_BOT_CONFIG || path.join(workspace, '.scena', 'bot-secrets.json'));
    let botConfig = {};
    try {
      const stat = await fs.stat(configPath);
      if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('Файл настроек должен быть доступен только владельцу.');
      botConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' || process.env.SCENA_BOT_CONFIG) throw error;
    }
    const config = readProductionConfig(process.env, botConfig);
    stage = 'открытие хранилища';
    const { createServer } = await import('./index.mjs');
    const { createSupabase } = await import('./supabase.mjs');
    const { accountStore, emailAuth } = createSupabase(config.supabase);
    backend = await createServer({ ...config.serverOptions, authOptions: {
      ...config.serverOptions.authOptions, accountStore,
      ...(config.emailEnabled ? { emailAuth } : {}),
    } });
    stage = 'запуск API';
    await new Promise((resolve, reject) => {
      backend.once('error', reject);
      backend.listen(config.port, config.host, () => { backend.off('error', reject); resolve(); });
    });
    if (config.botOptions) {
      stage = 'подключение Telegram';
      const { createTelegramBots } = await import('./telegram-bots.mjs');
      bots = createTelegramBots({ ...config.botOptions, service: backend.auth.bots });
      await bots.configure();
      await bots.start();
    }
    const shutdown = () => void stop().catch(() => {
      console.error('SCENZA: ошибка остановки сервиса.');
      process.exitCode = 1;
    });
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log(`SCENZA: API запущен на ${config.host}:${config.port}.`);
  } catch {
    // External errors may contain Telegram tokens or Supabase credentials.
    console.error(`SCENZA: запуск не завершён. Этап: ${stage}.`);
    await stop().catch(() => {});
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
