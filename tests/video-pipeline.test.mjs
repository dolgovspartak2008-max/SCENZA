import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { normalizeSettings, buildSubtitles, cropExpression, safeAdPosition, ff, render, inspect } from '../server/ai/render.mjs';

test('clip settings reject invalid ranges and enforce two minutes', () => {
  assert.throws(() => normalizeSettings({ start: 0, end: 121 }, 300));
  assert.throws(() => normalizeSettings({ start: -1, end: 20 }, 300));
  assert.throws(() => normalizeSettings({ start: 0, end: Infinity }, 300));
  assert.throws(() => normalizeSettings({ start: 0, end: 120.005 }, 300));
  assert.throws(() => normalizeSettings({ start: 0, end: 30.005 }, 30));
  assert.throws(() => normalizeSettings({ start: 0, end: 20 }, NaN));
  assert.equal(normalizeSettings({ start: 2, end: 22 }, 30).subtitleStyle, 'Classic');
});
test('Dynamic karaoke preserves word start times across speech pauses', () => {
  const settings = normalizeSettings({ start: 0, end: 10, subtitleStyle: 'Dynamic' }, 30);
  const result = buildSubtitles([{ start: 1, end: 5, text: 'Первое второе', words: [{ start: 1.4, end: 2, word: ' Первое' }, { start: 3, end: 4, word: ' второе' }] }], settings, 1080, 1920);
  assert.match(result, /\{\\k40\} /);
  assert.match(result, /\{\\k160\}Первое/);
  assert.match(result, /\{\\k100\}второе/);
});
test('subtitle timestamps carry rounded centiseconds into the next minute', () => {
  const settings = normalizeSettings({ start: 0, end: 100 }, 100);
  const result = buildSubtitles([{ start: 59.999, end: 61, text: 'Реплика' }], settings, 1080, 1920);
  assert.match(result, /0:01:00\.00,0:01:01\.00/);
  assert.ok(!result.includes('0:00:60.00'));
});
test('timed Cyrillic subtitles are clipped to clip and do not inject ASS tags', () => {
  const result = buildSubtitles([{ start: 8, end: 12, text: 'Привет {\\pos(0,0)}' }, { start: 25, end: 28, text: 'Outside' }], normalizeSettings({ start: 10, end: 20 }, 30), 1080, 1920);
  assert.match(result, /0:00:00\.00,0:00:02\.00/);
  assert.match(result, /Привет/);
  assert.ok(!result.includes('Outside'));
  assert.ok(!result.includes('{\\pos(0,0)}'));
});
test('literal subtitle corrections preserve cached word timestamps and escape ASS instructions', () => {
  const segments = [{ start: 10, end: 12, text: 'Фаме $&', words: [{ start: 10, end: 11, word: ' Фаме' }, { start: 11, end: 12, word: ' $&' }] }];
  const original = structuredClone(segments);
  const settings = normalizeSettings({ start: 10, end: 12, subtitleStyle: 'Dynamic', subtitleReplacements: [{ from: 'Фаме', to: 'Фоме' }, { from: '$&', to: '{\\pos(0,0)}$&' }] }, 30);
  assert.deepEqual(settings.subtitleReplacements, [{ from: 'Фаме', to: 'Фоме' }, { from: '$&', to: '{\\pos(0,0)}$&' }]);
  const ass = buildSubtitles(segments, settings, 1080, 1920);
  assert.match(ass, /0:00:00\.00,0:00:02\.00/);
  assert.match(ass, /\{\\k100\}Фоме/);
  assert.ok(ass.includes('｛＼pos(0,0)｝$&')); assert.ok(!ass.includes('{\\pos(0,0)}')); assert.ok(!ass.includes('Фаме'));
  assert.deepEqual(segments, original);
  const plain = buildSubtitles([{ start: 10, end: 11, text: 'Фаме' }], settings, 1080, 1920);
  assert.ok(plain.includes('Фоме'));
});
test('editor rejects unsafe subtitle correction values at its input boundary', () => {
  for (const subtitleReplacements of [null, {}, [{ from: '', to: 'a' }], [{ from: 'a', to: 'b', command: 'evil' }], [{ from: 'a', to: 'b'.repeat(101) }], Array(31).fill({ from: 'a', to: 'b' })]) assert.throws(() => normalizeSettings({ subtitleReplacements }, 30));
  assert.deepEqual(normalizeSettings({}, 30).subtitleReplacements, []);
});
test('chained subtitle corrections cannot expand cached text without a bound', () => {
  const settings = normalizeSettings({ subtitleReplacements: Array(3).fill({ from: 'а', to: 'а'.repeat(100) }) }, 30);
  assert.throws(() => buildSubtitles([{ start: 0, end: 1, text: 'а', words: [{ start: 0, end: 1, word: 'а' }] }], settings, 1080, 1920), /Замены/);
});
test('long word-timestamp segments become bounded cues without losing or repeating speech', () => {
  const words = Array.from({ length: 50 }, (_, index) => ({ start: index * 0.45, end: index * 0.45 + 0.3, word: ` слово${index}` }));
  for (const subtitleStyle of ['Classic', 'Dynamic']) {
    const ass = buildSubtitles([{ start: 0, end: 23, text: words.map(word => word.word.trim()).join(' '), words }], normalizeSettings({ start: 2, end: 20, subtitleStyle }, 30), 1080, 1920);
    const cues = ass.split('\n').filter(line => line.startsWith('Dialogue:'));
    assert.ok(cues.length > 5);
    const shown = [];
    const time = value => value.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
    let previousEnd = 0;
    for (const cue of cues) {
      const fields = cue.split(','), start = time(fields[1]), end = time(fields[2]);
      const text = fields.slice(9).join(',').replace(/\{[^}]*\}/g, '').replaceAll('\\N', ' ').trim();
      assert.ok(text.length <= 45, text); assert.ok(text.split(/\s+/).length <= 6, text);
      assert.ok(end - start <= 3.001); assert.ok(start >= previousEnd); assert.ok(start >= 0 && end <= 18);
      previousEnd = end; shown.push(...text.split(/\s+/));
    }
    assert.deepEqual(shown, words.filter(word => word.end > 2 && word.start < 20).map(word => word.word.trim()));
  }
});
test('cue boundaries preserve long silent gaps rather than stretching a sentence over them', () => {
  const words = [{ start: 1, end: 1.5, word: 'Первая' }, { start: 8, end: 8.5, word: 'Вторая' }];
  const ass = buildSubtitles([{ start: 1, end: 9, text: 'Первая Вторая', words }], normalizeSettings({ start: 0, end: 10 }, 10), 1080, 1920);
  assert.match(ass, /0:00:01\.00,0:00:01\.50/); assert.match(ass, /0:00:08\.00,0:00:08\.50/);
});
test('long legacy captions require real word timestamps instead of fabricated timing', () => {
  assert.throws(() => buildSubtitles([{ start: 0, end: 20, text: 'Очень длинная реплика '.repeat(20) }], normalizeSettings({ start: 0, end: 20 }, 30), 1080, 1920), /тайминг/);
});
test('crop follows normalized face positions and automatic ad avoids subtitles', () => {
  const settings = normalizeSettings({ start: 0, end: 10, cropSmoothing: 0 }, 30);
  const expr = cropExpression([{ time: 0, x: 0.2 }, { time: 5, x: 0.8 }], settings);
  assert.match(expr, /0\.2/); assert.match(expr, /0\.8/);
  assert.equal(safeAdPosition([], settings), 'top');
});
test('dense two-minute camera tracking evaluates in real FFmpeg', async () => {
  const tracking = Array.from({ length: 240 }, (_, index) => ({ time: index / 2, x: 0.5 + Math.sin(index / 10) * 0.3 }));
  const expression = cropExpression(tracking, normalizeSettings({ start: 0, end: 120 }, 120));
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-frames:v', '1', '-vf', `crop=202:360:'${expression}':0`, '-f', 'null', '-'], { timeout: 15000 });
});
test('subtitle presets each produce distinct readable ASS styles', () => {
  const lines = ['Minimal', 'Classic', 'Dynamic', 'Bold', 'Cinematic'].map(subtitleStyle => buildSubtitles([], normalizeSettings({ subtitleStyle }, 30), 1080, 1920).split('\n').find(line => line.startsWith('Style:')));
  assert.equal(new Set(lines).size, 5);
});
test('automatic ad considers full face bounds instead of only their top edge', () => {
  assert.equal(safeAdPosition([{ faces: [{ y: 0.2, height: 0.4 }] }], normalizeSettings({ subtitles: true }, 30)), 'strip');
});
test('smart framing without detected faces preserves source edges over a blurred background', async t => {
  const folder = await mkdtemp(path.resolve('tmp/ai-framing-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const input = path.join(folder, 'source.mp4');
  await ff(['-f', 'lavfi', '-i', 'color=red:size=320x180:rate=1,drawbox=x=0:y=0:w=30:h=ih:color=lime:t=fill,drawbox=x=iw-30:y=0:w=30:h=ih:color=lime:t=fill', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
  for (const cropMode of ['smart', 'manual']) {
    const output = path.join(folder, `${cropMode}.mp4`);
    await render({ input, output, settings: normalizeSettings({ start: 0, end: 1, cropMode, subtitles: false }, 1), analysis: { tracking: [{ time: 0, x: 0.5, faces: [] }] }, preview: true });
    const metadata = await inspect(output);
    assert.equal(metadata.width, 540); assert.equal(metadata.height, 960);
    const sample = spawnSync(ffmpeg, ['-v', 'error', '-i', output, '-vf', 'crop=2:2:20:480', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
    assert.equal(sample.status, 0);
    const [red, green] = sample.stdout;
    assert.ok(cropMode === 'smart' ? green > red + 100 : red > green + 100, `${cropMode}: red=${red} green=${green}`);
  }
});
