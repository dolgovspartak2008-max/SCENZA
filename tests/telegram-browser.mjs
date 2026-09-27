import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server/index.mjs';
import { createTelegramBots } from '../server/telegram-bots.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://scenza.test';
const dist = path.resolve('dist');
await fs.access(path.join(dist, 'index.html'));
const testRoot = path.resolve('tmp');
await fs.mkdir(testRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(testRoot, 'telegram-browser-'));
const inbox = [], sent = [], errors = [], externalRequests = [];
const allowedOrigins = [origin];
const backend = await createServer({ dataDir: root, seed: false, allowLocalStudio: false, allowedOrigins,
  authOptions: { allowedOrigins, telegramBotUsername: 'SCENZA_BOT', botRegistrationEnabled: true, legalReady: true, emailDelivery: async message => inbox.push(message) },
});
const bots = createTelegramBots({ clientToken: 'fake-client', registrationEnabled: true, service: backend.auth.bots,
  fetch: async (url, init) => {
    sent.push({ method: url.split('/').at(-1), ...JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  },
});
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json' };
  const routeRequest = async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://t.me') {
      assert.equal(url.pathname, '/SCENZA_BOT');
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Fake Telegram</title><p>Telegram transport is simulated by the test.</p>' });
      return;
    }
    if (url.origin !== origin) {
      externalRequests.push(url.origin + url.pathname);
      await route.abort('blockedbyclient');
      return;
    }
    if (/^\/(api|media|downloads)\//.test(url.pathname)) {
      const response = await route.fetch({ url: `http://127.0.0.1:${backend.address().port}${url.pathname}${url.search}` });
      await route.fulfill({ response });
      return;
    }
    const requested = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    assert.ok(requested === dist || requested.startsWith(dist + path.sep), 'Static path stays inside dist');
    const file = path.extname(requested) ? requested : path.join(dist, 'index.html');
    try { await route.fulfill({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body: await fs.readFile(file) }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await route.fulfill({ status: 404, body: 'Missing static test asset' });
    }
  };
  await context.route('**/*', routeRequest);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let update = 0;
  const person = { id: 424242, first_name: 'Мария', last_name: 'Тестовая', username: 'browser_test' };
  const msg = text => ({ update_id: ++update, message: { from: person, chat: { id: person.id, type: 'private' }, text } });
  const callback = data => ({ update_id: ++update, callback_query: { id: `cb${update}`, from: person, message: { chat: { id: person.id, type: 'private' } }, data } });
  const action = prefix => {
    const value = sent.findLast(item => item.reply_markup?.inline_keyboard.flat().some(button => button.callback_data?.startsWith(prefix)))?.reply_markup.inline_keyboard.flat().find(button => button.callback_data?.startsWith(prefix))?.callback_data;
    assert.ok(value, `Bot offered ${prefix}`);
    return value;
  };
  const telegram = async () => {
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForURL(/^https:\/\/t\.me\/SCENZA_BOT\?start=login_[A-Za-z0-9_-]{43}$/);
    const start = new URL(popup.url()).searchParams.get('start');
    assert.equal(await popup.evaluate(() => window.opener === null), true);
    await bots.handleClient(msg(`/start ${start}`));
    await popup.close();
    await page.bringToFront();
  };
  const studio = async label => {
    await page.waitForURL(`${origin}/app`);
    await page.locator('.app-shell').waitFor();
    await page.locator('.loading-panel').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.connection-error').count(), 0);
    await page.getByRole('link', { name: 'Настройки', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Мой аккаунт', exact: true }).count(), 0);
    const session = await page.evaluate(() => fetch('/api/auth/session').then(response => response.json()));
    assert.equal(session.user.email || session.user.name, label);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  };
  const account = async label => {
    await page.goto(origin);
    const header = page.locator('.scenza-header-actions');
    await header.getByRole('button', { name: label, exact: true }).waitFor();
    assert.equal(await header.getByRole('button', { name: 'Войти', exact: true }).count(), 0);
    await header.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('heading', { name: 'Ваш аккаунт SCENZA' }).waitFor();
    if (label === 'Мария Тестовая') await page.getByText(`Telegram ID: ${person.id}`, { exact: true }).waitFor();
  };
  const logout = async () => {
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await page.getByRole('heading', { name: 'Вход в систему', exact: true }).waitFor();
    await page.locator('.scenza-header-actions').getByRole('button', { name: 'Войти', exact: true }).waitFor();
    assert.equal((await context.cookies(origin)).some(cookie => cookie.name === 'scena_session' && cookie.value), false);
  };

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Telegram',
  });
  await mobileContext.route('**/*', routeRequest);
  const mobile = await mobileContext.newPage();
  const mobilePopups = [];
  mobile.on('popup', popup => mobilePopups.push(popup));
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.addInitScript(() => {
    const open = window.open.bind(window);
    window.telegramHandoffs = [];
    window.open = (url, target, features) => {
      if (String(url).startsWith('tg:') && target === '_self') {
        window.telegramHandoffs.push(String(url));
        return null; // Simulate the OS accepting the Telegram handoff, keeping the website alive.
      }
      return open(url, target, features);
    };
  });
  await mobile.goto(origin);
  await mobile.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await mobile.getByRole('button', { name: 'Войти', exact: true }).first().click();
  await mobile.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
  const fallback = mobile.getByRole('link', { name: 'Открыть бота SCENZA', exact: true });
  await fallback.waitFor();
  assert.equal(mobilePopups.length, 0, 'Mobile Telegram login never opens an about:blank popup');
  const botUrl = new URL(await fallback.getAttribute('href'));
  assert.equal(botUrl.origin, 'https://t.me', 'A real HTTPS fallback remains available without the Telegram app');
  assert.deepEqual(await mobile.evaluate(() => window.telegramHandoffs), [`tg://resolve?domain=SCENZA_BOT&start=${botUrl.searchParams.get('start')}`]);
  assert.equal(mobile.url(), `${origin}/`, 'The website remains open while Telegram confirms login');
  const mobilePerson = { id: 424243, first_name: 'Мобильный', username: 'mobile_browser_test' };
  await bots.handleClient({ update_id: ++update, message: { from: mobilePerson, chat: { id: mobilePerson.id, type: 'private' }, text: `/start ${botUrl.searchParams.get('start')}` } });
  for (const prefix of ['webregister:', 'terms:', 'consent:']) {
    await bots.handleClient({ update_id: ++update, callback_query: { id: `cb${update}`, from: mobilePerson, message: { chat: { id: mobilePerson.id, type: 'private' } }, data: action(prefix) } });
  }
  await mobile.waitForURL(`${origin}/app`);
  await mobile.locator('.app-shell').waitFor();
  assert.equal((await mobileContext.cookies(origin)).some(cookie => cookie.name === 'scena_session' && cookie.httpOnly), true);
  await mobileContext.close();
  console.log('PASS: mobile Telegram handoff without blank popups, HTTPS fallback, bot consent, bound session and /app redirect');

  await page.goto(origin);
  await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Регистрация', exact: true }).click();
  assert.equal(await page.getByRole('dialog').locator('input[type=checkbox]:checked').count(), 0);
  await telegram();
  assert.equal(await backend.auth.bots.userByTelegram(person.id), null);
  await bots.handleClient(callback(action('webregister:')));
  await bots.handleClient(callback(action('terms:')));
  assert.equal(await backend.auth.bots.userByTelegram(person.id), null);
  await bots.handleClient(callback(action('consent:')));
  await studio('Мария Тестовая');
  const firstTrial = (await backend.auth.bots.userByTelegram(person.id)).trialStartedAt;
  const session = (await context.cookies(origin)).find(cookie => cookie.name === 'scena_session');
  assert.ok(session?.httpOnly);
  assert.equal(session.sameSite, 'Strict');
  assert.ok(session.expires > Date.now() / 1000 + 29 * 86400, 'Telegram signup remembers the account for 30 days');
  await account('Мария Тестовая');
  await logout();
  console.log('PASS: public-hostname Telegram signup, unchecked web consents, two bot consents, bound cookie, /app redirect, account header and logout');

  await telegram();
  await bots.handleClient(callback(action('weblogin:')));
  await studio('Мария Тестовая');
  assert.equal((await backend.auth.bots.userByTelegram(person.id)).trialStartedAt, firstTrial);
  await account('Мария Тестовая');
  await logout();
  console.log('PASS: existing Telegram account confirms login and retains the original trial');

  await page.getByRole('tab', { name: 'Регистрация', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#scenza-name').fill('Public Browser');
  await dialog.locator('#scenza-email').fill('public-browser@example.com');
  await dialog.locator('#scenza-password').fill('browser-password-42');
  await dialog.getByRole('checkbox').nth(0).check();
  await dialog.getByRole('checkbox').nth(1).check();
  await dialog.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.locator('#scenza-code').waitFor();
  assert.equal(inbox.length, 1);
  await page.locator('#scenza-code').fill(inbox[0].code);
  await page.getByRole('button', { name: 'Подтвердить и войти', exact: true }).click();
  await studio('public-browser@example.com');
  await account('Public Browser');
  await logout();
  assert.deepEqual(externalRequests, [], 'All frontend requests stay on intercepted test origins');
  assert.deepEqual(errors, [], 'No browser errors');
  console.log('PASS: email signup and OTP on a public hostname, /app workspace, email header, logout; no external requests or browser errors');
} finally {
  await browser?.close();
  await bots.stop();
  await new Promise(resolve => backend.close(resolve));
  await backend.auth.flush();
  assert.ok(root.startsWith(testRoot + path.sep));
  await fs.rm(root, { recursive: true, force: true });
}
