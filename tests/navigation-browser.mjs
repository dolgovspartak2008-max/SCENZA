import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  const body = path === '/api/auth/session' ? { user: { id: 'navigation-user', accessActive: true }, localStudioAllowed: false }
    : path === '/api/settings' ? { settings: { defaultFormat: '9:16', quality: '1080p', telegramConnected: false } }
    : path === '/api/video/config' ? { aiReady: true }
    : path === '/api/video/projects/navigation-project' ? { project: { id: 'navigation-project', title: 'Проверка навигации', status: 'UPLOADING', upload: { name: 'video.mp4', size: 100, bytes: 0 }, candidates: [], versions: [], files: {}, music: [] } }
    : { projects: [], clips: [], publications: [] };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await mkdir('tmp/ui-checks', { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/app/settings`);
    const breadcrumbs = page.getByRole('navigation', { name: 'Хлебные крошки' });
    await breadcrumbs.waitFor();
    assert.equal(await breadcrumbs.getByRole('link', { name: 'Главная', exact: true }).count(), 1, 'Home breadcrumb must link to the landing page');
    assert.equal(await breadcrumbs.getByRole('link', { name: 'Главная', exact: true }).getAttribute('href'), '/');
    assert.equal(await breadcrumbs.getByRole('link', { name: 'Настройки', exact: true }).getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.avatar img').count(), 0);
    assert.equal(await page.locator('.avatar svg').count(), 1);
    assert.equal(await page.locator('.sidebar a[href="https://t.me/SCENZA_BOT"]').getAttribute('target'), '_blank');
    await page.screenshot({ path: `tmp/ui-checks/navigation-${width}.png`, fullPage: true });
    await breadcrumbs.getByRole('link', { name: 'Локальная студия', exact: true }).click();
    await page.waitForURL(`${base}/app`);
    await page.getByRole('button', { name: 'Открыть настройки', exact: true }).click();
    await page.waitForURL(`${base}/app/settings`);
    await page.getByRole('heading', { name: 'Настройки', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Ручная библиотека', exact: true }).count(), 0);
    await page.goto(`${base}/app/library`);
    await page.waitForURL(`${base}/app/ai`);
    await page.getByRole('button', { name: 'Новый проект', exact: true }).waitFor();
    for (const [path, parent] of [['/upload', '/app/ai'], ['/ai/navigation-project', '/app/ai'], ['/upload/manual', '/app/ai']]) {
      await page.goto(`${base}/app${path}`);
      if (path === '/upload/manual') await page.waitForURL(`${base}/app/upload`);
      await breadcrumbs.waitFor();
      const parentLink = breadcrumbs.locator(`a[href="${parent}"]`);
      assert.equal(await parentLink.count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No page overflow at ${width}: ${path}`);
      await parentLink.click();
      await page.waitForURL(`${base}${parent}`);
    }
    await breadcrumbs.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.waitForURL(`${base}/`);
    await page.locator('.app-shell').waitFor({ state: 'detached' });
    await page.goBack();
    await breadcrumbs.waitFor();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: breadcrumbs, landing/back navigation, upload/project parents, neutral settings icon at 1440/390/320; no page overflow or browser errors. API fixtures only.');
} finally { await browser.close(); }
