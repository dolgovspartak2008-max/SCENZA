import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const video = await readFile('.scena/render-check/preview.mp4');
const banner = await readFile('.scena/render-check/banner.png');
const settings = { start: 1, end: 9, format: '9:16', cropX: 50, cropMode: 'smart', cropSmoothing: .7, muted: false, subtitles: true, subtitleStyle: 'Classic', subtitleSize: 54, subtitlePosition: 'bottom', musicId: '', musicVolume: .18 };
const candidates = [
  { id: 'moment-one', start: 1, end: 9, title: 'Неожиданный поворот разговора', description: 'Короткий диалог с понятным контекстом и выразительной реакцией героя.', category: 'Диалог', score: 94, reason: 'Сильная реплика в начале и завершённая мысль в конце.', hook: 'Один вопрос меняет разговор.' },
  { id: 'moment-two', start: 10, end: 19, title: 'Реакция, которую невозможно предугадать', description: 'Второй момент для проверки выбора сцены и категории.', category: 'Юмор', score: 87, reason: 'Контраст ожидания и реакции поддерживает внимание.', hook: 'Именно этого никто не ожидал.' },
];
function fixture(status) {
  const project = { id: 'visual-fixture', title: 'Диалог и неожиданный поворот — проверка редактора', createdAt: '2026-09-13T12:00:00Z', status, duration: 23.35, upload: { name: 'video.mp4', size: 7_689_662, bytes: 7_689_662 }, candidates, versions: [], files: Object.fromEntries(['moment-one', 'moment-two', 'version-one', 'version-two', 'banner', 'advert-preview', 'final'].map(id => [id, { key: id }])), music: [{ id: 'track-one', name: 'Спокойная инструментальная музыка' }] };
  if (status !== 'READY') Object.assign(project, { settings: { ...settings }, currentVersion: 'version-two', versions: [{ id: 'version-one', number: 1, settings: { ...settings, format: '1:1' }, createdAt: '2026-09-13T12:00:00Z' }, { id: 'version-two', number: 2, settings: { ...settings }, createdAt: '2026-09-13T12:01:00Z' }] });
  if (['ADDING_AD', 'COMPLETED'].includes(status)) Object.assign(project, { ad: { fileId: 'banner', position: 'auto', width: 40, start: 0, duration: 4, opacity: .9 }, adPreview: 'advert-preview' });
  if (status === 'COMPLETED') Object.assign(project, { finalFile: 'final', exports: [{ id: 'version-one', createdAt: '2026-09-13T12:03:00Z', format: '1:1', duration: 8 }, { id: 'final', createdAt: '2026-09-13T12:04:00Z', format: '9:16', duration: 8 }] });
  return project;
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [];
let project = fixture('READY');
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/api/auth/session', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({user:{id:'browser-user',accessActive:true}}) }));
// All video API fixtures exist only in this browser route; no server data is seeded.
await page.route('**/api/video/**', async route => {
  const request = route.request(), url = new URL(request.url()), method = request.method();
  const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  if (url.pathname === '/api/video/config') return json({ aiReady: true, maxFileSize: 20 * 1024 ** 3, chunkSize: 8 * 1024 ** 2 });
  if (url.pathname === '/api/video/usage') return json({ month: '2026-09', sourceMinutes: 120, sourceCount: 2, editRequests: 3 });
  if (url.pathname === '/api/video/projects' && method === 'GET') return json({ projects: [fixture('COMPLETED'), { ...fixture('READY'), id: 'not-exported', title: 'Проект без готовых роликов' }] });
  if (url.pathname.startsWith('/api/video/projects/visual-fixture/files/')) {
    const image = url.pathname.endsWith('/banner'), body = image ? banner : video;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || '');
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || body.length - 1), body.length - 1);
      return route.fulfill({ status: 206, headers: { 'Content-Type': image ? 'image/png' : 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes' }, body: body.subarray(start, end + 1) });
    }
    return route.fulfill({ status: 200, contentType: image ? 'image/png' : 'video/mp4', body });
  }
  if (url.pathname === '/api/video/projects/visual-fixture' && method === 'GET') return json({ project });
  if (url.pathname.startsWith('/api/video/projects/visual-fixture/') && ['POST', 'PUT'].includes(method)) {
    const action = url.pathname.split('/').at(-1), body = request.postDataJSON() || {};
    requests.push({ action, method, body });
    if (action === 'preview') {
      project.settings = body.settings; project.currentVersion = 'version-three'; project.status = 'AWAITING_APPROVAL';
      delete project.adPreview;
      project.files['version-three'] = { key: 'version-three' };
      project.versions.push({ id: 'version-three', number: 3, settings: body.settings, createdAt: '2026-09-13T12:02:00Z' });
    }
    if (action === 'restore') { project.currentVersion = body.versionId; project.settings = project.versions.find(v => v.id === body.versionId).settings; }
    if (action === 'advertisement') { project.ad = body; delete project.adPreview; }
    if (action === 'ad-preview') project.adPreview = 'advert-preview';
    if (action === 'approve') project.status = 'APPROVED';
    if (action === 'export') { project.status = 'COMPLETED'; project.finalFile = 'final'; }
    return json({ project });
  }
  errors.push(`Unexpected video API request: ${method} ${url.pathname}`);
  return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Unexpected browser fixture request"}' });
});
async function screenshot(state, width) {
  await page.locator('video').evaluateAll(videos => Promise.all(videos.map(async video => {
    const muted = video.muted;
    video.muted = true;
    await video.play();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video frame did not decode')), 10000);
      video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
    });
    video.pause();
    await new Promise(resolve => { video.onseeked = resolve; video.currentTime = Math.min(1, video.duration / 2); });
    video.muted = muted;
  })));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${state} overflows at ${width}px`);
  await page.screenshot({ path: `tmp/ui-checks/ai-review-${state}-${width}.png`, fullPage: true });
}
try {
  await mkdir('tmp/ui-checks', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const state of ['READY', 'AWAITING_APPROVAL', 'ADDING_AD', 'COMPLETED']) {
      project = fixture(state);
      await page.goto(`${base}/app/ai/visual-fixture`);
      if (state === 'READY') {
        await page.getByRole('heading', { name: 'Готовые ролики' }).waitFor();
        assert.equal(await page.locator('.ai-candidate').count(), 2);
        await screenshot('candidates', width);
        await page.getByLabel('Категория').selectOption('Юмор');
        assert.equal(await page.locator('.ai-candidate').count(), 1);
      } else {
        await page.locator('.ai-review').waitFor();
        assert.equal(await page.locator('.ai-candidate:visible').count(), 0);
        const otherMoment = page.getByRole('button', { name: 'Выбрать другой момент', exact: true });
        assert.equal(await otherMoment.getAttribute('aria-expanded'), 'false');
        await otherMoment.click();
        assert.equal(await page.locator('.ai-candidate:visible').count(), 2);
        await otherMoment.click();
        assert.equal(await page.getByLabel('Версия').inputValue(), 'version-two');
        await page.locator('.ai-result').first().evaluate(video => new Promise((resolve, reject) => { if (video.readyState >= 1) return resolve(); video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Video fixture failed to decode')); }));
        if (state === 'AWAITING_APPROVAL') {
          assert.equal(await page.getByLabel('Что изменить?').isVisible(), true);
          assert.equal(await page.getByLabel('Формат', { exact: true }).isVisible(), false);
          assert.equal(await page.locator('.ai-manual').evaluate(details => details.open), false);
          await screenshot('editor', width);
          await page.getByText('Настроить вручную', { exact: true }).click();
          assert.equal(await page.getByLabel('Формат').inputValue(), '9:16');
          await page.getByLabel('Стиль субтитров').selectOption({ label: 'TikTok' });
          assert.equal(await page.getByLabel('Стиль субтитров').inputValue(), 'Bold');
          assert.equal(await page.getByRole('option', { name: 'Cinema', exact: true }).getAttribute('value'), 'Cinematic');
          await page.getByLabel('Формат').selectOption('1:1');
          await page.getByLabel('Кадрирование').selectOption('manual');
          await page.getByLabel('Начало, сек.').fill('2');
          await page.getByLabel('Стиль субтитров').selectOption('Dynamic');
          assert.equal(await page.getByRole('button', { name: 'Всё устраивает — подтвердить ролик' }).isDisabled(), true);
          await page.getByRole('button', { name: 'Применить настройки', exact: true }).click();
          await page.waitForFunction(() => document.querySelector('.ai-review select')?.value === 'version-three');
          const preview = requests.findLast(r => r.action === 'preview');
          assert.equal(preview.body.settings.format, '1:1'); assert.equal(preview.body.settings.start, 2); assert.equal(preview.body.settings.cropMode, 'manual'); assert.equal(preview.body.settings.subtitleStyle, 'Dynamic');
          await page.getByLabel('Что изменить?').fill('Сделай субтитры меньше.');
          await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/revise') && response.request().method() === 'POST'),
            page.getByRole('button', { name: 'Внести изменения', exact: true }).click(),
          ]);
          assert.equal(requests.findLast(r => r.action === 'revise').body.request, 'Сделай субтитры меньше.');
          await page.getByLabel('Версия').selectOption('version-one');
          await page.waitForFunction(() => document.querySelector('.ai-review select')?.value === 'version-one');
          assert.equal(requests.findLast(r => r.action === 'restore').body.versionId, 'version-one');
        }
        if (state === 'ADDING_AD') {
          await page.getByRole('img', { name: 'Ваш баннер' }).waitFor();
          assert.match(await page.locator('.ai-banner input[type=file]').getAttribute('accept'), /\.mp4/);
          assert.equal(await page.getByRole('button', { name: 'Экспортировать MP4', exact: true }).isDisabled(), false);
          await screenshot('advertisement', width);
          await page.getByRole('button', { name: 'Поверх видео', exact: true }).click();
          await page.getByLabel('Положение').selectOption('bottom-right');
          assert.equal(await page.getByRole('button', { name: 'Экспортировать MP4', exact: true }).isDisabled(), true);
          await page.getByRole('button', { name: 'Сохранить баннер', exact: true }).click();
          await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Экспортировать MP4')?.disabled);
          assert.equal(requests.findLast(r => r.action === 'advertisement').body.position, 'bottom-right');
          await page.getByRole('button', { name: 'Точный предпросмотр MP4 с баннером', exact: true }).click();
          await page.waitForFunction(() => document.querySelector('video[aria-label="Предпросмотр итогового ролика с баннером"]'));
          assert.ok(requests.some(r => r.action === 'ad-preview'));
          await page.getByText('Изменить формат', { exact: true }).click();
          await page.getByLabel('Новый формат', { exact: true }).selectOption('16:9');
          assert.equal(await page.getByRole('button', { name: 'Экспортировать MP4', exact: true }).isDisabled(), true);
          await page.getByRole('button', { name: 'Применить формат', exact: true }).click();
          await page.getByRole('button', { name: 'Всё устраивает — подтвердить ролик' }).waitFor();
          assert.equal(requests.findLast(r => r.action === 'preview').body.settings.format, '16:9');
          assert.equal(await page.locator('.ai-ad').count(), 0);
        }
        if (state === 'COMPLETED') {
          assert.equal(await page.getByRole('link', { name: 'Скачать MP4', exact: true }).getAttribute('href'), '/api/video/projects/visual-fixture/files/final');
          assert.ok((await page.locator('.ai-result').first().getAttribute('src')).endsWith('/final'));
          await screenshot('completed', width);
        }
      }
    }
    await page.goto(`${base}/app/ai`);
    await page.getByRole('heading', { name: 'Мои проекты', exact: true }).waitFor();
    await page.getByText('Готовые ролики: 2', { exact: true }).waitFor();
    assert.equal(await page.getByText('Готовые ролики: 0', { exact: true }).count(), 1);
    assert.equal(await page.locator('.ai-project-exports a:visible').count(), 0);
    await page.getByText('Готовые ролики: 2', { exact: true }).click();
    assert.equal(await page.locator('.ai-project-exports a:visible').count(), 2);
    assert.deepEqual(await page.locator('.ai-project-exports a:visible').evaluateAll(links => links.map(link => link.getAttribute('href'))), ['/api/video/projects/visual-fixture/files/version-one', '/api/video/projects/visual-fixture/files/final']);
    await screenshot('exports', width);
  }
  for (const width of [1440,390]) {
    project = fixture('READY');
    project.candidates = project.candidates.map(candidate => ({ ...candidate, ready:true, duration:8, settings:{...settings}, segments:[{start:1,end:9}], keywords:['вопрос'] }));
    await page.setViewportSize({width,height:1000});
    await page.goto(`${base}/app/ai/visual-fixture`);
    await page.getByRole('heading',{name:'Готовые ролики',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Скачать MP4',exact:true}).count(),2);
    await page.getByRole('heading',{name:'Баннер — по желанию'}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.getByRole('button',{name:'Настроить ролик',exact:true}).first().click();
    await page.locator('.ai-review').waitFor();
    assert.deepEqual(requests.findLast(item=>item.action==='preview').body.settings.segments,[{start:1,end:9}]);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: simplified editor and export history at 1440/390, real media decoding, collapsed candidates/manual controls, safe format re-approval, version/settings/revision/ad payloads, no overflow or console/page errors.');
} finally { await browser.close(); }
