import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server/index.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const testRoot = path.resolve('tmp');
await fs.mkdir(testRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(testRoot, 'auth-browser-'));
const screenshots = path.resolve('tmp/ui-auth');
await fs.mkdir(screenshots, { recursive: true });
const inbox = [];
const disabled = await createServer({ dataDir: path.join(root, 'disabled'), seed: false });
const connected = await createServer({ dataDir: path.join(root, 'connected'), seed: false, authOptions: { legalReady: true, emailDelivery: async message => inbox.push(message) } });
await Promise.all([disabled, connected].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
let backend = disabled;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route(/\/(api|media|downloads)\//, async route => {
  const url = new URL(route.request().url());
  const response = await route.fetch({ url: `http://127.0.0.1:${backend.address().port}${url.pathname}${url.search}` });
  await route.fulfill({ response });
});
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Вход в систему' });
  await dialog.waitFor();
  await page.waitForTimeout(300);
  assert.equal(await dialog.getByRole('button', { name: 'Войти через Telegram', exact: true }).isDisabled(), true);
  await dialog.locator('#scenza-password').fill('sample-password');
  await dialog.getByRole('button', { name: 'Показать пароль', exact: true }).click();
  assert.equal(await dialog.locator('#scenza-password').getAttribute('type'), 'text');
  await dialog.getByRole('button', { name: 'Скрыть пароль', exact: true }).click();
  await dialog.locator('#scenza-password').fill('');
  await page.screenshot({ path: path.join(screenshots, 'login-desktop.png') });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `login overflows at ${width}`);
    if (width === 390) await page.screenshot({ path: path.join(screenshots, 'login-mobile.png') });
  }
  await dialog.getByRole('tab', { name: 'Регистрация', exact: true }).click();
  const registration = page.getByRole('dialog', { name: 'Регистрация', exact: true });
  assert.equal(await registration.locator('input[type=checkbox]:checked').count(), 0);
  await registration.locator('summary').click();
  await registration.getByRole('radio').last().check();
  assert.match(await registration.locator('summary').innerText(), /Pro/);
  await registration.locator('select').selectOption('year');
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await registration.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  await page.screenshot({ path: path.join(screenshots, 'register-mobile.png') });
  await page.keyboard.press('Escape');
  for (const key of ['privacy', 'consent', 'terms', 'offer', 'payment', 'cookies', 'contacts']) {
    await page.goto(`${base}/legal/${key}`);
    await page.locator('h1').waitFor();
    assert.match(await page.locator('main').innerText(), /Проект документа/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${key} overflows`);
  }
  await page.screenshot({ path: path.join(screenshots, 'legal-mobile.png'), fullPage: true });
  console.log('PASS: default-disabled login, password visibility, unchecked consents, plan selection, 7 legal pages, 320/390/768/1440 layouts');

  backend = connected;
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(base);
  await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Регистрация', exact: true }).click();
  await registration.locator('#scenza-email').fill('browser-test@example.com');
  await registration.locator('#scenza-password').fill('sample-password');
  await registration.getByRole('checkbox').nth(0).check();
  await registration.getByRole('checkbox').nth(1).check();
  await registration.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.locator('#scenza-code').waitFor();
  assert.equal(inbox.length, 1);
  await page.locator('#scenza-code').fill(inbox[0].code);
  await page.getByRole('button', { name: 'Подтвердить и войти', exact: true }).click();
  await page.getByRole('heading', { name: 'Ваш аккаунт SCENZA' }).waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /Пробный доступ активен/);
  await page.getByRole('link', { name: 'Перейти в студию' }).click();
  await page.locator('.scenza-session-strip').waitFor();
  await page.locator('.loading-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.connection-error').count(), 0);
  await page.getByRole('link', { name: 'Аккаунт и выход' }).click();
  await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await page.getByRole('heading', { name: 'Вход в систему' }).waitFor();
  const storage = await page.evaluate(() => ({ ...localStorage }));
  assert.equal(JSON.stringify(storage).includes('sample-password'), false);
  assert.equal(JSON.stringify(storage).includes('scena_session'), false);
  assert.deepEqual(errors, []);
  console.log('PASS: email registration with injected delivery, OTP confirmation, session cookie, isolated studio, logout, no console errors');
} finally {
  await browser.close();
  await Promise.all([disabled, connected].map(server => new Promise(resolve => server.close(resolve))));
  assert.ok(root.startsWith(testRoot + path.sep));
  await fs.rm(root, { recursive: true, force: true });
}
