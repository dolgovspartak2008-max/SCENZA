import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ffmpeg from 'ffmpeg-static';
import { normalizeSettings, buildSubtitles, render } from '../server/ai/render.mjs';

test('subtitle custom color survives normalization and ASS styling without changing preset defaults', () => {
  const settings = normalizeSettings({ subtitleColor: '#12abEF' }, 30);
  assert.equal(settings.subtitleColor, '#12abEF');
  assert.match(buildSubtitles([], settings, 1080, 1920), /&H00EFab12/i);
  assert.match(buildSubtitles([], normalizeSettings({ subtitleStyle: 'Bold' }, 30), 1080, 1920), /&H0000DFFF/);
  for (const subtitleColor of ['#fff', 'red', null, '#12345g', 'white,Arial,99']) assert.throws(() => normalizeSettings({ subtitleColor }, 30));
});

test('real FFmpeg render visibly applies subtitle size and color', async () => {
  const dir = mkdtempSync(path.resolve('tmp/subtitle-render-'));
  try {
    const input = path.join(dir, 'source.mp4');
    const source = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x320:r=1:d=1', '-c:v', 'libx264', '-y', input], { windowsHide: true });
    assert.equal(source.status, 0, source.stderr?.toString());
    const counts = [];
    for (const [subtitleSize, subtitleColor] of [[24, '#FFFF00'], [96, '#FF0000']]) {
      const output = path.join(dir, `size-${subtitleSize}.mp4`);
      await render({ input, output, preview: true, settings: normalizeSettings({ start: 0, end: 1, format: '1:1', subtitleStyle: 'Minimal', subtitleSize, subtitleColor }, 1), analysis: { segments: [{ start: 0, end: 1, text: 'ТЕСТ' }] } });
      const pixels = spawnSync(ffmpeg, ['-v', 'error', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, maxBuffer: 2 * 1024 ** 2 });
      assert.equal(pixels.status, 0, pixels.stderr?.toString());
      let colored = 0;
      for (let i = 0; i < pixels.stdout.length; i += 3) {
        const [r, g, b] = pixels.stdout.subarray(i, i + 3);
        if (r > 100 && b < r / 2 && (subtitleColor === '#FFFF00' ? g > 100 : g < r / 2)) colored++;
      }
      assert.ok(colored > 10, `Expected ${subtitleColor} subtitle pixels, found ${colored}`); counts.push(colored);
    }
    assert.ok(counts[1] > counts[0] * 4, `Increasing subtitle size must increase visible glyph area: ${counts}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const localPython = path.resolve('.scena/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.SCENZA_PYTHON || (existsSync(localPython) ? localPython : 'python3');
const available = spawnSync(python, ['--version'], { encoding: 'utf8' }).status === 0;
const visualAvailable = available && spawnSync(python, ['-c', 'import cv2, scenedetect'], { encoding: 'utf8' }).status === 0;
const cli = path.resolve('server/ai/media.py');
const run = (...args) => spawnSync(python, [cli, ...args], { encoding: 'utf8', timeout: 120_000 });

test('media CLI rejects missing input with safe JSON and no result file', { skip: !available }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scenza-media-'));
  try {
    const output = path.join(dir, 'result.json');
    const result = run('analyze', '--input', path.join(dir, 'missing.mp4'), '--output', output);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr.trim()).error.code, 'INPUT_NOT_FOUND');
    assert.equal(existsSync(output), false);
    assert.doesNotMatch(result.stderr, /Traceback/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('media CLI reports missing dependencies instead of returning invented analysis', { skip: !available }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scenza-media-'));
  try {
    const input = path.join(dir, 'source.mp4');
    const output = path.join(dir, 'result.json');
    writeFileSync(input, 'dependency check');
    const result = spawnSync(python, ['-S', cli, 'analyze', '--input', input, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr.trim()).error.code, 'DEPENDENCIES_MISSING');
    assert.equal(existsSync(output), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('media CLI detects real scene cuts and yields bounded fallback crop positions', { skip: !visualAvailable }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scenza-media-'));
  try {
    const input = path.join(dir, 'scenes.mp4');
    const output = path.join(dir, 'inspect.json');
    const created = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=10:d=2', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=10:d=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-y', input], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const inspected = run('inspect', '--input', input, '--output', output);
    assert.equal(inspected.status, 0, inspected.stderr);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.width, 320);
    assert.equal(result.height, 180);
    assert.equal(result.scenes.length, 2);
    assert.ok(Math.abs(result.scenes[0].end - 2) < 0.11);
    assert.ok(Math.abs(result.scenes[1].end - 4) < 0.11);
    assert.ok(result.tracking.length >= 4);
    assert.ok(result.tracking.every(({ time, x, faces }) => time >= 0 && time < 4 && x === 0.5 && faces.length === 0));
    const tracked = run('track', '--input', input, '--output', output, '--start', '1', '--end', '3');
    assert.equal(tracked.status, 0, tracked.stderr);
    const track = JSON.parse(readFileSync(output, 'utf8')).tracking;
    assert.ok(track.length > 0);
    assert.ok(track.every(({ time }) => time >= 1 && time < 3));
    const invalid = run('track', '--input', input, '--output', path.join(dir, 'invalid.json'), '--start', '3', '--end', '1');
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stderr.trim()).error.code, 'INVALID_RANGE');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
