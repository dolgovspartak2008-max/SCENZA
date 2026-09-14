import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  const demo = page.locator('.product-demo--wide');
  await demo.waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.scenza-page-loader').waitFor({ state: 'hidden' });
  await demo.locator('.pd-rail').getByRole('button', { name: 'Субтитры', exact: true }).click();
  await demo.locator('.pd-seek').fill('7.8');
  assert.equal(await demo.locator('.pd-caption').textContent(), 'Ствол не отдам');
  await demo.locator('.pd-subtitle-track button').first().click();
  const longText = 'Это длинный текст для проверки переноса строк и наложения субтитров в предпросмотре видео. Все слова должны оставаться видимыми на маленьком экране телефона.';
  await demo.locator('textarea').fill(longText);
  await mkdir('tmp/editor-checks', { recursive: true });
  for (const width of [390, 320, 600, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const format of ['9:16', '1:1', '16:9']) {
      await demo.locator('.pd-formats').getByRole('button', { name: format, exact: true }).click();
      for (const preset of [0, 1, 2]) {
        await demo.locator('.pd-preset').nth(preset).click();
        const geometry = await demo.locator('.pd-frame').evaluate(frame => {
          const box = frame.getBoundingClientRect();
          const text = frame.querySelector('.pd-caption').getBoundingClientRect();
          return { fits: text.top >= box.top && text.bottom <= box.bottom && text.left >= box.left && text.right <= box.right, lower: text.top >= box.top + box.height / 2, ratio: box.width / box.height };
        });
        assert.ok(geometry.fits, `${width}px / ${format} / style ${preset}: caption leaves frame`);
        assert.ok(geometry.lower, `${width}px / ${format} / style ${preset}: caption must stay in the lower half`);
        const [w, h] = format.split(':').map(Number);
        assert.ok(Math.abs(geometry.ratio - w / h) < .02, `${width}px: incorrect ${format} aspect ratio`);
      }
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: page overflow`);
    console.log(`PASS ${width}px: all formats and subtitle styles fit`);
  }
  const rail = demo.locator('.pd-rail');
  await rail.getByRole('button', { name: 'Настройки', exact: true }).click();
  await demo.getByRole('button', { name: 'Сбросить демо', exact: true }).click();
  assert.ok((await demo.locator('video').getAttribute('src')).endsWith('editor-5958-clean.mp4'));
  const duration = await demo.locator('video').evaluate(video => video.duration);
  assert.ok(duration > 23 && duration < 24);
  const play = () => demo.getByRole('button', { name: 'Воспроизвести сцены', exact: true }).click();
  const pause = () => demo.getByRole('button', { name: 'Остановить просмотр сцен', exact: true }).click();
  await play();
  await page.waitForFunction(() => document.querySelector('.pd-source').currentTime > .3);
  await pause();
  assert.ok(await demo.locator('video').evaluate(video => video.paused));
  await demo.locator('.pd-scene').nth(2).click();
  assert.ok(Math.abs(Number(await demo.locator('.pd-seek').inputValue()) - duration * 2 / 3) < .1);
  await demo.getByRole('button', { name: 'Посмотреть следующий фрагмент', exact: true }).click();
  assert.equal(Number(await demo.locator('.pd-seek').inputValue()), 0);
  await demo.getByRole('button', { name: 'Выключить звук', exact: true }).click();
  assert.ok(await demo.locator('video').evaluate(video => video.muted));
  await demo.getByRole('button', { name: 'Включить звук', exact: true }).click();
  await demo.getByRole('button', { name: 'Полноэкранный режим', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await demo.locator('.pd-seek').fill(String(Number((duration - .3).toFixed(2))));
  await play();
  await page.waitForFunction(() => document.querySelector('.pd-source').ended);
  await play();
  await page.waitForFunction(() => { const v = document.querySelector('.pd-source'); return !v.paused && v.currentTime > .1 && v.currentTime < 2; });
  await pause();
  console.log('PASS video: source, full duration, play, pause, seek, segments, sound, fullscreen, end and replay');

  await rail.getByRole('button', { name: 'Субтитры', exact: true }).click();
  await demo.locator('.pd-subtitle-track button').first().click();
  await demo.locator('textarea').fill(longText);
  const subtitleStart = Number(await demo.locator('.pd-seek').inputValue());
  const phrases = [];
  for (let i = 0; i < 20; i++) {
    await demo.locator('.pd-seek').fill(String(Number((subtitleStart + 1.35 * i / 20).toFixed(2))));
    const phrase = await demo.locator('.pd-caption').textContent();
    if (phrases.at(-1) !== phrase) phrases.push(phrase);
  }
  assert.equal(phrases.join('').replace(/\s/g, ''), longText.replace(/\s/g, ''), 'caption segmentation must not lose words');
  await demo.locator('.pd-subtitle-track button').first().click();
  await demo.locator('textarea').fill('');
  assert.equal(await demo.locator('.pd-caption').count(), 0);
  await demo.locator('textarea').fill('Ш'.repeat(160));
  await demo.getByLabel('Шрифт', { exact: true }).selectOption('Georgia, serif');
  assert.match(await demo.locator('.pd-caption').evaluate(text => getComputedStyle(text).fontFamily), /Georgia/);
  await demo.locator('.pd-formats').getByRole('button', { name: '9:16', exact: true }).click();
  await rail.getByRole('button', { name: 'Слои', exact: true }).click();
  for (const label of ['Субтитры', 'Затемнение фона']) await demo.getByRole('checkbox', { name: label, exact: true }).uncheck();
  assert.equal(await demo.locator('.pd-caption, .pd-frame-shade').count(), 0);
  await demo.getByRole('checkbox', { name: 'Субтитры', exact: true }).check();
  await rail.getByRole('button', { name: 'Настройки', exact: true }).click();
  await demo.locator('.pd-field input[type=range]').fill('20');
  assert.equal(await demo.locator('video').evaluate(video => video.style.objectPosition), '20% center');
  console.log('PASS captions: all words preserved, empty text, layers and manual framing');

  await rail.getByRole('button', { name: 'Звук', exact: true }).click();
  await demo.locator('input[type=file]').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  assert.match(await demo.locator('.pd-notice:visible').textContent(), /аудиофайл до 50 МБ/);
  const wav = Buffer.alloc(44 + 16000 * 2 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await demo.locator('input[type=file]').setInputFiles({ name: 'test-audio.wav', mimeType: 'audio/wav', buffer: wav });
  await demo.locator('video').scrollIntoViewIfNeeded();
  await play();
  await page.waitForFunction(() => document.querySelector('.product-demo audio')?.currentTime > .1);
  await rail.getByRole('button', { name: 'Субтитры', exact: true }).click();
  assert.equal(await demo.locator('audio').count(), 1);
  await page.waitForFunction(() => document.querySelector('.product-demo audio')?.ended);
  await demo.locator('.pd-seek').fill('0');
  await page.waitForFunction(() => { const audio = document.querySelector('.product-demo audio'); return !audio.paused && audio.currentTime > .1 && audio.currentTime < 1; });
  await pause();
  await page.waitForFunction(() => document.querySelector('.product-demo audio')?.paused);
  assert.ok(await demo.locator('audio').evaluate(audio => audio.paused));
  console.log('PASS audio: validation, upload, playback, tab switching, seek and pause');

  await rail.getByRole('button', { name: 'Настройки', exact: true }).click();
  await demo.getByRole('button', { name: 'Сбросить демо', exact: true }).click();
  assert.equal(await demo.locator('audio').count(), 0);
  assert.equal(await demo.locator('.pd-frame--1-1').count(), 1);
  await rail.getByRole('button', { name: 'Субтитры', exact: true }).click();
  assert.equal(await demo.getByLabel('Шрифт', { exact: true }).inputValue(), '');
  await demo.getByLabel('Нижние субтитры', { exact: true }).selectOption('8');
  assert.equal(await demo.locator('.pd-caption').textContent(), 'Пропустите');
  await demo.locator('textarea').fill('Новая нижняя фраза');
  assert.equal(await demo.locator('.pd-caption').textContent(), 'Новая нижняя фраза');
  await demo.locator('.pd-seek').fill('7.8');
  assert.equal(await demo.locator('textarea').inputValue(), 'Ствол не отдам');
  await demo.getByLabel('Шрифт', { exact: true }).selectOption('Georgia, serif');
  await page.evaluate(() => {
    window.exportedText = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
      window.exportedText.push({ text, x, y, height: this.canvas.height, font: this.font });
      return fillText.call(this, text, x, y, ...args);
    };
  });
  await demo.locator('.pd-titlebar').getByRole('button', { name: 'Экспортировать', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать кадр PNG', exact: true }).click();
  const png = await download;
  assert.equal(await png.failure(), null);
  await png.saveAs('tmp/editor-checks/export.png');
  const drawnText = await page.evaluate(() => window.exportedText);
  assert.ok(drawnText.length > 0);
  assert.equal(drawnText.map(line => line.text).join(' '), 'Ствол не отдам');
  assert.ok(drawnText.every(line => line.y > line.height / 2 && line.y < line.height && line.font.includes('Georgia')), 'PNG must use the lower caption and chosen font');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  console.log('PASS reset and PNG download');

  await demo.locator('.pd-rail').getByRole('button', { name: 'Субтитры', exact: true }).click();
  await page.evaluate(() => document.activeElement?.blur());
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await demo.screenshot({ path: `tmp/editor-checks/editor-${width}.png` });
    if (width === 390) {
      await demo.locator('.pd-viewer').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'tmp/editor-checks/editor-mobile-viewport.png' });
    }
    await page.locator('#workflow').screenshot({ path: `tmp/editor-checks/workflow-${width}.png` });
  }
  await page.evaluate(() => localStorage.setItem('scenza.language', 'en'));
  await page.reload();
  await demo.waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.scenza-page-loader').waitFor({ state: 'hidden' });
  assert.match(await demo.locator('.pd-disclosure').textContent(), /Limited editor demo/);
  assert.match(await page.locator('#workflow').textContent(), /in development/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('PASS Russian/English copy, responsive screenshots and console');
} finally {
  await browser.close();
}
