import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readProductionConfig } from '../server/production.mjs';

const env = {
  SCENA_PUBLIC_ORIGIN: 'https://scenza.example/',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: 'test-secret',
  SUPABASE_PUBLISHABLE_KEY: 'test-public',
};
const bots = {
  clientToken: `123456:${'a'.repeat(30)}`,
  adminToken: `654321:${'b'.repeat(30)}`,
  ownerTelegramIds: [123456],
};

test('production defaults isolate the service and leave registration disabled', () => {
  const config = readProductionConfig(env);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5174);
  assert.equal(config.serverOptions.dataDir, path.resolve('.scena/service'));
  assert.equal(config.serverOptions.seed, false);
  assert.equal(config.serverOptions.allowLocalStudio, false);
  assert.deepEqual(config.serverOptions.allowedOrigins, ['https://scenza.example']);
  assert.deepEqual(config.serverOptions.authOptions.allowedOrigins, ['https://scenza.example']);
  assert.equal(config.serverOptions.authOptions.secureCookies, true);
  assert.equal(config.serverOptions.authOptions.trustProxy, true);
  assert.equal(config.serverOptions.authOptions.legalReady, false);
  assert.equal(config.emailEnabled, false);
  assert.equal(config.botOptions, null);
  assert.deepEqual(config.supabase, { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SECRET_KEY, publicKey: env.SUPABASE_PUBLISHABLE_KEY });
});

test('production requires HTTPS origins, Supabase credentials and a valid listening port', () => {
  for (const value of ['', 'http://scenza.example', 'https://user:password@scenza.example', 'https://scenza.example/path', 'https://scenza.example?key=secret', 'https://scenza.example/#fragment']) {
    assert.throws(() => readProductionConfig({ ...env, SCENA_PUBLIC_ORIGIN: value }), /SCENA_PUBLIC_ORIGIN/);
  }
  for (const key of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY']) {
    assert.throws(() => readProductionConfig({ ...env, [key]: ' ' }), new RegExp(key));
  }
  assert.throws(() => readProductionConfig({ ...env, SUPABASE_URL: 'http://project.supabase.co' }), /SUPABASE_URL/);
  for (const value of ['0', '-1', '65536', '1.5', 'not-a-port', '']) {
    assert.throws(() => readProductionConfig({ ...env, SCENA_PORT: value }), /SCENA_PORT/);
  }
  const configured = readProductionConfig({ ...env, SCENA_PORT: '5184', SCENA_DATA_DIR: 'tmp/service', SCENA_EMAIL_ENABLED: 'true' });
  assert.equal(configured.port, 5184);
  assert.equal(configured.serverOptions.dataDir, path.resolve('tmp/service'));
  assert.equal(configured.emailEnabled, true);
});

test('legal readiness requires an explicit true and environment can disable config consent', () => {
  assert.equal(readProductionConfig(env, { legalReady: true }).serverOptions.authOptions.legalReady, true);
  assert.equal(readProductionConfig({ ...env, SCENA_LEGAL_READY: 'true' }).serverOptions.authOptions.legalReady, true);
  assert.equal(readProductionConfig({ ...env, SCENA_LEGAL_READY: 'false' }, { legalReady: true }).serverOptions.authOptions.legalReady, false);
  assert.equal(readProductionConfig(env, { legalReady: 'true' }).serverOptions.authOptions.legalReady, false);
  assert.equal(readProductionConfig({ ...env, SCENA_EMAIL_ENABLED: '1' }).emailEnabled, false);
});

test('optional bots use the production origin and explicit website and registration switches', () => {
  const config = readProductionConfig(env, { ...bots, siteUrl: 'https://obsolete.example', registrationEnabled: true, websiteLoginEnabled: true });
  assert.equal(config.botOptions.siteUrl, 'https://scenza.example');
  assert.equal(config.botOptions.registrationEnabled, true);
  assert.equal(config.botOptions.stateFile, path.resolve('.scena/service/telegram-offsets.json'));
  assert.deepEqual(config.serverOptions.authOptions.ownerTelegramIds, ['123456']);
  assert.equal(config.serverOptions.authOptions.telegramClientId, '123456');
  assert.equal(config.serverOptions.authOptions.telegramBotUsername, 'SCENZA_BOT');
  assert.equal(config.serverOptions.authOptions.botRegistrationEnabled, true);
  assert.equal(config.serverOptions.authOptions.legalReady, false);
  assert.equal(readProductionConfig(env, bots).serverOptions.authOptions.telegramClientId, '');
  for (const invalid of [{ ...bots, clientToken: 'invalid' }, { ...bots, clientToken: undefined }, { ...bots, ownerTelegramIds: [] }, { ...bots, ownerTelegramIds: ['bad'] }]) {
    assert.throws(() => readProductionConfig(env, invalid), /Telegram/);
  }
});

test('production uses one client bot for login and administration, including memory-only credentials', () => {
  const config = readProductionConfig(env, { ...bots, adminToken: undefined });
  assert.equal(config.botOptions.clientToken, bots.clientToken);
  assert.equal(config.botOptions.adminToken, undefined);
  assert.equal(readProductionConfig(env, bots).botOptions.adminToken, undefined);
  const memory = readProductionConfig({ ...env, SCENA_BOT_TOKEN: bots.clientToken }, { ownerTelegramIds: [123456] });
  assert.equal(memory.botOptions.clientToken, bots.clientToken);
});

test('explicitly enabled Telegram cannot silently start without its persistent token', () => {
  const missingToken = { ownerTelegramIds: [123456], registrationEnabled: true };
  assert.throws(() => readProductionConfig({ ...env, SCENA_BOTS_ENABLED: 'true' }, missingToken), /Telegram.*токен/);
  assert.equal(readProductionConfig({ ...env, SCENA_BOTS_ENABLED: 'false' }, missingToken).botOptions, null);
  assert.equal(readProductionConfig(env, missingToken).botOptions, null);
  assert.equal(readProductionConfig({ ...env, SCENA_BOTS_ENABLED: 'true' }, bots).botOptions.clientToken, bots.clientToken);
});

test('disabling bot polling preserves Telegram login and owner settings', () => {
  const botConfig = { ...bots, registrationEnabled: true, websiteLoginEnabled: true };
  const enabled = readProductionConfig(env, botConfig);
  const disabled = readProductionConfig({ ...env, SCENA_BOTS_ENABLED: 'false' }, botConfig);
  assert.equal(disabled.botOptions, null);
  assert.equal(disabled.serverOptions.authOptions.telegramBotUsername, '');
  assert.deepEqual(disabled.serverOptions.authOptions, { ...enabled.serverOptions.authOptions, telegramBotUsername: '' });
  assert.notEqual(readProductionConfig({ ...env, SCENA_BOTS_ENABLED: 'true' }, botConfig).botOptions, null);
});
