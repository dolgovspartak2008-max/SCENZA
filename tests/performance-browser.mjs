import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const failures = [], errors = [], metrics = [];
try {
  await mkdir('tmp/performance-checks', { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname === '/api/auth/session' ? { user: { id: 'performance-user', accessActive: true } }
        : pathname === '/api/video/config' ? { aiReady: true }
        : { projects: [], clips: [], publications: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(base);
    await page.locator('.scenza-page-loader').waitFor({ state: 'hidden' });
    await page.waitForTimeout(800);
    const initialVideos = requests.filter(url => /\.mp4(?:\?|$)/.test(url));
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({ name: entry.name, bytes: entry.transferSize })));
    metrics.push({ width, initialVideos, transferredBytes: resources.reduce((sum, entry) => sum + entry.bytes, 0) });
    if (initialVideos.length) failures.push(`${width}: videos fetched before interaction: ${initialVideos.join(', ')}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `tmp/performance-checks/landing-${width}.png` });
    const demo = page.locator('.product-demo--wide');
    await demo.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.pd-source').readyState >= 2);
    await demo.getByRole('button', { name: 'Воспроизвести сцены', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pd-source').currentTime > .2);
    await demo.getByRole('button', { name: 'Остановить просмотр сцен', exact: true }).click();
    await demo.locator('.pd-scene').nth(2).click();
    await page.waitForFunction(() => {
      const video = document.querySelector('.pd-source');
      return !video.seeking && Math.abs(video.currentTime - video.duration * 2 / 3) < .1;
    });
    const example = page.locator('.scenza-example').first();
    await example.scrollIntoViewIfNeeded();
    await example.getByRole('button', { name: /^Смотреть видео:/ }).click();
    await page.waitForFunction(() => document.querySelector('.scenza-example video').currentTime > .2);
    await page.goto(`${base}/legal/contacts`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await page.locator('.scenza-legal-nav a').count(), 7);
    await page.goto(`${base}/app`);
    await page.locator('.studio-art').evaluate(image => image.decode());
    const imageBytes = await page.locator('.studio-art').evaluate(async image => (await (await fetch(image.currentSrc)).arrayBuffer()).byteLength);
    metrics.push({ width, studioImageBytes: imageBytes });
    if (imageBytes > 300_000) failures.push(`${width}: studio background exceeds 300 KB (${imageBytes})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `tmp/performance-checks/studio-${width}.png` });
    if (width === 1440) {
      await page.getByRole('link', { name: 'Готовые клипы', exact: true }).click();
      await page.getByRole('heading', { name: 'Готовые клипы', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Главная', exact: true }).click();
      await page.getByRole('heading', { name: 'Создайте свой ролик', exact: true }).waitFor();
    }
    await page.close();
  }
  for (const fallback of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(fallback => {
      if (fallback) HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
      window.previewDraws = 0;
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        window.previewDraws++;
        return drawImage.apply(this, args);
      };
    }, fallback);
    const project = {
      id: 'performance-preview', title: 'Проверка предпросмотра', image: '/videos/editor-5958-clean-1.jpg',
      alt: '', genre: 'Демо', status: 'Черновик', tone: 'draft', action: 'Открыть',
      video: '/videos/editor-5958-clean.mp4', duration: 23.348345, width: 640, height: 360,
      settings: { sceneId: '', start: 0, end: 1.5, format: '9:16', cropX: 50, muted: true, subtitleText: '', subtitleStyle: 'classic', banner: null },
    };
    await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/session'
      ? { user: { id: 'performance-user', accessActive: true } } : { projects: [project], project } }));
    await page.goto(`${base}/app/projects/${project.id}`);
    await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.video-player video').currentTime > .4);
    assert.ok(await page.evaluate(() => window.previewDraws > 2), 'Video frames reach the preview canvas');
    await page.waitForFunction(() => {
      const video = document.querySelector('.video-player video');
      return video.paused && Math.abs(video.currentTime - 1.5) < .05;
    });
    await page.waitForTimeout(300);
    const pausedDraws = await page.evaluate(() => window.previewDraws);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.previewDraws), pausedDraws, 'Paused canvas stops drawing');
    await page.getByRole('slider', { name: 'Позиция воспроизведения' }).fill('0.3');
    await page.waitForFunction(previous => window.previewDraws > previous, pausedDraws);
    console.log(`PASS editor canvas: ${fallback ? 'animation-frame fallback' : 'video frames'}, trim end, pause and seek`);
    await page.close();
  }
  await writeFile(`tmp/performance-checks/${process.env.PERF_LABEL || 'latest'}.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(failures, [], 'Performance budget');
  console.log('PASS: media budgets, playback, seek, studio navigation and mobile overflow');
} finally {
  await browser.close();
}
