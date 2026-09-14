import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const errors = [], failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
let studio = false;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  const arc = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.classList.contains('scenza-particle-background')) window.particlePoints = [];
    return clear.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.arc = function (...args) {
    if (this.canvas.classList.contains('scenza-particle-background')) window.particlePoints.push(args.slice(0, 3));
    return arc.apply(this, args);
  };
});
await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  const body = pathname === '/api/auth/session' ? { user: studio ? { id: 'layout-test', accessActive: true } : null }
    : pathname === '/api/auth/config' ? { emailEnabled: true, legalReady: true }
    : pathname === '/api/video/config' ? { aiReady: true, maxFileSize: 20 * 1024 ** 3, chunkSize: 8 * 1024 ** 2 }
    : { projects: [] };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
try {
  await mkdir('tmp/ui-checks', { recursive: true });
  await page.goto(base);
  await page.locator('.scenza-hero').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.scenza-landing:not([inert])').waitFor();
  await page.waitForTimeout(300);
  const points = await page.evaluate(() => window.particlePoints.slice(0, 10));
  await page.setViewportSize({ width: 390, height: 924 });
  await page.waitForTimeout(300);
  check(JSON.stringify(points) === JSON.stringify(await page.evaluate(() => window.particlePoints.slice(0, 10))), 'Viewport height changes must preserve existing particles');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    if (width <= 1000) {
      await page.locator('.scenza-menu-button').click();
      const menu = page.locator('#scenza-mobile-nav');
      check((await menu.boundingBox()).height <= 245, `Compact menu at ${width}px`);
      check(await menu.locator('a').count() === 4, 'All navigation destinations retained');
      check(await menu.getByRole('button', { name: 'Войти', exact: true }).isVisible(), 'Login visible');
      await page.screenshot({ path: `tmp/ui-checks/mobile-menu-${width}.png` });
      await menu.getByRole('button', { name: 'Начать', exact: true }).click();
    } else {
      await page.locator('.scenza-header-actions').getByRole('button', { name: 'Начать', exact: true }).click();
    }
    const dialog = page.getByRole('dialog', { name: 'Регистрация', exact: true });
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    const close = await dialog.locator('.scenza-dialog-close').boundingBox();
    const tabs = await dialog.locator('.scenza-auth-tabs').boundingBox();
    check(close.width >= 44 && close.height >= 44, `Close touch target at ${width}px`);
    check(close.y + close.height + 6 <= tabs.y, `Close/focus outline stays above tabs at ${width}px`);
    check(close.x + close.width + 6 < box.x + box.width, `Close stays inside dialog at ${width}px`);
    await page.screenshot({ path: `tmp/ui-checks/registration-${width}.png` });
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Landing fits ${width}px`);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(700, 500);
  await page.waitForTimeout(300);
  const light = page.locator('.scenza-cursor-spotlight');
  const before = await light.boundingBox();
  await page.evaluate(() => scrollTo({ top: document.querySelector('#hero').offsetHeight - 300, behavior: 'instant' }));
  await page.waitForTimeout(200);
  const after = await light.boundingBox();
  check(Math.abs(after.y - before.y) < 2, 'Cursor glow stays at the pointer when scrolling');
  const layer = await page.locator('.scenza-spotlight-layer').boundingBox();
  check(layer.y <= 0 && layer.height >= 900, 'Glow is not clipped at the hero/examples boundary');
  await page.screenshot({ path: 'tmp/ui-checks/continuous-glow.png' });
  studio = true;
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/app`);
    await page.getByRole('heading', { name: 'Создайте свой ролик', exact: true }).waitFor();
    check(await page.locator('.studio-tools').isVisible() === (width > 760), `Studio information visibility at ${width}px`);
    check(await page.getByRole('link', { name: 'Мой аккаунт', exact: true }).count() === 0, 'Account menu item removed');
    check(await page.getByRole('button', { name: 'Загрузить видео', exact: true }).isVisible(), 'Upload remains available');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Studio fits ${width}px`);
    await page.screenshot({ path: `tmp/ui-checks/studio-layout-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assert.deepEqual(failures, [], 'Mobile layout regressions');
  console.log('PASS: compact menu, close bounds, particle resize continuity, scrolling glow, mobile-only studio information, account removal; 320/390/768/1440px. API fixtures.');
} finally { await browser.close(); }
