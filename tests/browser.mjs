import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.APP_URL || 'http://127.0.0.1:5173') + '/app';
const output = path.resolve('tmp/ui-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.setDefaultTimeout(20000);
const errors = [], failures = [], created = { projects: [], clips: [], publications: [] };
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('status of 400')) errors.push(message.text()); });
async function check(name, action) {
  try { await action(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.slice(0, 450)}`); await page.screenshot({ path: path.join(output, `failure-${failures.length}.png`), fullPage: true }); }
}
async function loaded() { await page.waitForFunction(() => !document.querySelector('.loading-panel')); }
async function open(route = '/') { await page.goto(base + route, { waitUntil: 'networkidle' }); await loaded(); }
let projectId = '', clipId = '';
try {
  await check('все ролики главной воспроизводятся с реальным временем', async () => {
    await open('/#projects');
    const videos = page.locator('.project-card video');
    assert.ok(await videos.count() >= 4);
    for (let i = 0; i < await videos.count(); i++) {
      const video = videos.nth(i);
      await video.evaluate(async (element) => { element.muted = true; await element.play(); });
      await page.waitForFunction((index) => document.querySelectorAll('.project-card video')[index].currentTime > .15, i);
      const data = await video.evaluate((element) => ({ duration: element.duration, width: element.videoWidth, error: element.error }));
      assert.ok(data.duration > 0 && data.width > 0 && !data.error, JSON.stringify(data));
      await video.evaluate((element) => element.pause());
    }
    await page.getByRole('searchbox').fill('ТИХИЙ');
    assert.equal(await page.locator('.project-card').count(), 1);
    await page.getByRole('searchbox').fill('нет такого фильма');
    await page.getByRole('heading', { name: 'Ничего не найдено' }).waitFor();
  });
  await check('загрузка настоящего файла, анализ и открытие редактора', async () => {
    await open('/upload');
    assert.equal(await page.getByRole('button', { name: 'Начать анализ', exact: true }).isDisabled(), true);
    await page.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('not-video') });
    await page.getByRole('alert').filter({ hasText: 'Выберите видео' }).waitFor();
    await page.locator('input[type=file]').setInputFiles(path.join(output, 'functional-upload.mp4'));
    await page.getByRole('button', { name: 'Начать анализ', exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Начать анализ' && !b.disabled));
    const uploadVideo = page.getByLabel('Загруженное видео');
    await uploadVideo.waitFor();
    await uploadVideo.evaluate((v) => v.play());
    await page.waitForFunction(() => document.querySelector('.real-upload-file video').currentTime > .1);
    await page.getByRole('button', { name: 'Начать анализ', exact: true }).click();
    await page.getByRole('button', { name: 'Повторить анализ' }).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: 'Открыть редактор', exact: true }).click();
    await page.locator('.real-source video').waitFor();
    projectId = new URL(page.url()).pathname.split('/').at(-1); created.projects.push(projectId);
    await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.real-source video').currentTime > .2);
    await page.getByRole('button', { name: 'Приостановить видео', exact: true }).click();
  });
  await check('монтаж: trim, субтитры, баннер, сохранение после reload', async () => {
    assert.ok(projectId, 'Upload project missing');
    await page.locator('.trim-settings').getByLabel('Начало, сек.').fill('1');
    await page.locator('.trim-settings').getByLabel('Конец, сек.').fill('4');
    await page.getByRole('combobox', { name: /^Формат:/ }).selectOption('1:1');
    await page.getByRole('button', { name: 'Добавить текст', exact: true }).click();
    await page.locator('dialog textarea').fill('Проверка\nреального монтажа');
    await page.getByRole('button', { name: 'Сохранить текст', exact: true }).click();
    await page.getByRole('button', { name: 'Аа Акцент' }).click();
    await page.locator('.banner-settings summary').click();
    await page.locator('.banner-settings input[type=file]').setInputFiles(path.resolve('public/assets/coast.png'));
    await page.locator('.banner-upload img').waitFor();
    await page.locator('.banner-settings').getByLabel('Начало, сек.').fill('0');
    await page.locator('.banner-settings').getByLabel('Длительность').fill('2');
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.saved-state')?.textContent === 'Настройки сохранены');
    await page.reload({ waitUntil: 'networkidle' }); await loaded();
    assert.equal(await page.locator('.trim-settings').getByLabel('Начало, сек.').inputValue(), '1');
    assert.equal(await page.locator('.trim-settings').getByLabel('Конец, сек.').inputValue(), '4');
    assert.equal(await page.getByRole('combobox', { name: /^Формат:/ }).inputValue(), '1:1');
    assert.match(await page.locator('.preview-subtitle').innerText(), /реального монтажа/);
    await page.locator('.preview-banner').waitFor();
  });
  await check('MP4 действительно экспортируется, содержит видео и звук', async () => {
    await page.getByRole('button', { name: 'Экспортировать', exact: true }).click();
    await page.getByRole('link', { name: 'Скачать MP4', exact: true }).last().waitFor({ timeout: 120000 });
    const downloadLink = page.getByRole('link', { name: 'Скачать MP4', exact: true }).last();
    const href = await downloadLink.getAttribute('href'); clipId = href.split('/').at(-1).replace('.mp4', ''); created.clips.push(clipId);
    const downloadPromise = page.waitForEvent('download'); await downloadLink.click();
    const download = await downloadPromise; const saved = path.join(output, 'exported-functional.mp4'); await download.saveAs(saved);
    const probe = spawnSync(require('ffprobe-static').path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', saved], { encoding: 'utf8', windowsHide: true });
    assert.equal(probe.status, 0); const media = JSON.parse(probe.stdout); const video = media.streams.find((stream) => stream.codec_type === 'video');
    assert.equal(video.width, 720); assert.equal(video.height, 720); assert.ok(Math.abs(Number(media.format.duration) - 3) < .15); assert.ok(media.streams.some((stream) => stream.codec_type === 'audio'));
    const decode = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-i', saved, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true }); assert.equal(decode.status, 0, decode.stderr);
  });
  await check('готовые клипы и подготовка публикации работают', async () => {
    await open('/clips');
    const card = page.locator('.clip-card').filter({ hasText: 'functional-upload' }).first(); await card.waitFor();
    await card.getByRole('button', { name: 'Публикация', exact: true }).click();
    await page.getByRole('heading', { name: 'Публикации', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('clip'), clipId);
    await page.getByLabel('Подпись', { exact: true }).fill('Локальная проверка. Не отправлять.');
    const replyPromise = page.waitForResponse((response) => response.url().endsWith('/api/publications') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Подготовить публикацию', exact: true }).click();
    const reply = await (await replyPromise).json(); created.publications.push(reply.publication.id);
    await page.locator('.publication-item').filter({ hasText: 'Локальная проверка. Не отправлять.' }).waitFor();
    const item = page.locator('.publication-item').filter({ hasText: 'Локальная проверка. Не отправлять.' }).first();
    assert.ok(await item.getByRole('link', { name: /Открыть YouTube/ }).getAttribute('href'));
    await item.getByRole('button', { name: 'Отметить опубликованным' }).click();
    await item.getByText('Опубликовано', { exact: true }).waitFor();
    await item.getByRole('button', { name: 'Вернуть в подготовленные' }).click();
    await item.getByText('Подготовлено', { exact: true }).waitFor();
  });
  await check('импорт по публичной HTTPS ссылке создаёт реальное видео', async () => {
    await open('/upload');
    await page.getByRole('tab', { name: 'Ссылка на источник' }).click();
    await page.getByLabel('Адрес видео', { exact: true }).fill('https://media.w3.org/2010/05/bunny/trailer.mp4');
    await page.getByRole('button', { name: 'Загрузить по ссылке', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть редактор', exact: true }).waitFor({ timeout: 180000 });
    const media = page.getByLabel('Загруженное видео'); await media.evaluate((video) => { video.muted = true; return video.play(); });
    await page.waitForFunction(() => document.querySelector('.real-upload-file video').currentTime > .2);
    await page.getByRole('button', { name: 'Открыть редактор', exact: true }).click();
    created.projects.push(new URL(page.url()).pathname.split('/').at(-1));
  });
  await check('настройки сохраняются после перезагрузки', async () => {
    await open('/settings');
    const quality = page.getByRole('combobox', { name: /^Разрешение/ }); const original = await quality.inputValue();
    await quality.selectOption(original === '720p' ? '1080p' : '720p');
    await page.getByRole('button', { name: 'Сохранить параметры' }).click();
    await page.getByRole('status').filter({ hasText: 'Настройки сохранены' }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.notEqual(await quality.inputValue(), original);
    await quality.selectOption(original); await page.getByRole('button', { name: 'Сохранить параметры' }).click();
    await page.getByRole('status').filter({ hasText: 'Настройки сохранены' }).waitFor();
  });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, route] of [['overview', '/'], ['upload', '/upload'], ['editor', '/projects/tihiy-gorod'], ['clips', '/clips'], ['publications', '/publications'], ['settings', '/settings']]) {
      await check(`${name} ${width}px`, async () => {
        await open(route);
        await page.evaluate(async () => { await Promise.all([...document.images].map((image) => image.decode().catch(() => {}))); });
        await page.screenshot({ path: path.join(output, `live-${name}-${width}.png`), fullPage: true });
        const info = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src) }));
        assert.ok(info.scroll <= info.width + 1, JSON.stringify(info)); assert.equal(info.broken.length, 0, JSON.stringify(info.broken));
      });
    }
  }
  await check('мобильное меню и Escape', async () => {
    await open('/'); await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.getByRole('link', { name: 'Готовые клипы', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/app/clips');
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click(); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Открыть меню' }).getAttribute('aria-expanded'), 'false');
  });
  await check('нет ошибок JavaScript/консоли', async () => assert.deepEqual(errors, []));
} finally { await browser.close(); await writeFile(path.join(output, 'created-test-records.json'), JSON.stringify(created, null, 2)); }
console.log(JSON.stringify({ failures, errors, created, screenshots: output }));
if (failures.length) process.exitCode = 1;