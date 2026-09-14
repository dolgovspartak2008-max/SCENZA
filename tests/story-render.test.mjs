import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import * as renderer from '../server/ai/render.mjs';

test('story settings retain edit order and limit output duration rather than source envelope', () => {
  const settings = renderer.normalizeSettings({ segments: [{ start: 200, end: 220 }, { start: 10, end: 40 }], keywords: ['победа'] }, 300);
  assert.deepEqual(settings.segments, [{ start: 200, end: 220 }, { start: 10, end: 40 }]);
  assert.equal(settings.start, 10); assert.equal(settings.end, 220);
  assert.equal(renderer.timelineDuration(settings), 50);
  assert.equal(renderer.timelineDuration(renderer.normalizeSettings({ start: 2, end: 5 }, 10)), 3);
  for (const segments of [[], null, [{ start: 0, end: 121 }], [{ start: -1, end: 5 }], [{ start: 3, end: 2 }], [{ start: 290, end: 301 }], [{ start: 0, end: 80 }, { start: 100, end: 150 }]]) assert.throws(() => renderer.normalizeSettings({ segments }, 300));
});

test('story captions follow reordered source intervals and highlight requested words', () => {
  const segments = [{ start: 1, end: 3, text: 'начало', words: [{ start: 1, end: 2, word: 'начало' }] }, { start: 20, end: 22, text: 'Победа!', words: [{ start: 20.5, end: 21.5, word: 'Победа!' }] }, { start: 10, end: 11, text: 'вырезано' }];
  const original = structuredClone(segments);
  const settings = renderer.normalizeSettings({ segments: [{ start: 20, end: 24 }, { start: 0, end: 4 }], keywords: ['победа'] }, 30);
  const ass = renderer.buildSubtitles(segments, settings, 1080, 1920);
  const cues = ass.split('\n').filter(line => line.startsWith('Dialogue:'));
  assert.match(cues[0], /0:00:00\.00,0:00:01\.50.*Победа!/);
  assert.match(cues[1], /0:00:05\.00,0:00:06\.00.*начало/);
  assert.match(cues[0], /\\c&H00DFFF&/);
  assert.ok(!ass.includes('вырезано'));
  assert.deepEqual(segments, original);
});

test('automatic banners reserve a strip if every placement overlaps a face or caption', () => {
  assert.equal(renderer.safeAdPosition([{ faces: [{ y: .2, height: .4 }] }], renderer.normalizeSettings({}, 30)), 'strip');
});

test('phrase emphasis matches the whole phrase, including across subtitle cues', () => {
  const text = ['Это', 'начало', 'очень', 'важной', 'истории', 'наша', 'победа', 'наша', 'команда'];
  const words = text.map((word, i) => ({ word, start: i * .4, end: i * .4 + .3 }));
  for (const subtitleStyle of ['Classic', 'Dynamic']) {
    const ass = renderer.buildSubtitles([{ start: 0, end: 4, text: text.join(' '), words }], renderer.normalizeSettings({ start: 0, end: 4, subtitleStyle, keywords: ['наша победа'] }, 4), 1080, 1920);
    assert.equal((ass.match(/\\c&H00DFFF&/g) || []).length, 2);
    assert.match(ass, /\\b1\}наша\{\\r\}/);
    assert.match(ass, /\\b1\}победа\{\\r\}/);
  }
});

test('real FFmpeg story preserves selected order, summed duration and audio with banner strip', async t => {
  const dir = await mkdtemp(path.resolve('tmp/story-render-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'source.mp4'), output = path.join(dir, 'story.mp4'), banner = path.join(dir, 'banner.png');
  await renderer.ff(['-f', 'lavfi', '-i', 'color=red:size=320x180:rate=10:duration=2', '-f', 'lavfi', '-i', 'color=blue:size=320x180:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=900:duration=2', '-filter_complex', '[0:v][2:a][1:v][3:a]concat=n=2:v=1:a=1[v][a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', input]);
  await renderer.ff(['-f', 'lavfi', '-i', 'color=lime:size=100x40', '-frames:v', '1', banner]);
  await renderer.render({ input, output, preview: true, settings: renderer.normalizeSettings({ segments: [{ start: 2, end: 3.5 }, { start: 0, end: 1.5 }], subtitles: false }, 4), analysis: { hasAudio: true, tracking: [{ time: 0, x: .5, faces: [{ y: .1, height: .8 }] }, { time: 2, x: .5, faces: [{ y: .1, height: .8 }] }] }, ad: { file: banner, position: 'auto', start: 0, duration: 3, width: 70, opacity: 1 } });
  const metadata = await renderer.inspect(output);
  assert.equal(metadata.width, 540); assert.equal(metadata.height, 960); assert.ok(metadata.hasAudio);
  assert.ok(Math.abs(metadata.duration - 3) < .15, metadata.duration);
  for (const [time, expected] of [[.5, 'blue'], [2, 'red']]) {
    const sample = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', output, '-vf', 'crop=2:2:270:360', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
    assert.equal(sample.status, 0);
    const [red, , blue] = sample.stdout;
    assert.ok(expected === 'blue' ? blue > red + 100 : red > blue + 100, `${time}: ${red}, ${blue}`);
  }
  const sound = spawnSync(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:a', '-ar', '8000', '-ac', '1', '-f', 's16le', 'pipe:1'], { windowsHide: true });
  assert.equal(sound.status, 0);
  const crossings = time => { let count = 0; for (let i = Math.round(time * 8000); i < Math.round((time + .25) * 8000); i++) if (sound.stdout.readInt16LE(i * 2) < 0 && sound.stdout.readInt16LE((i + 1) * 2) >= 0) count++; return count; };
  assert.ok(crossings(.5) > crossings(2) * 2, 'reordered audio must match blue (900 Hz), then red (300 Hz)');
  const adPixels = spawnSync(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', output, '-vf', 'crop=2:2:270:840', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
  assert.equal(adPixels.status, 0);
  const [red, green, blue] = adPixels.stdout;
  assert.ok(green > red + 100 && green > blue + 100, 'banner must be visible in its reserved strip');
});
