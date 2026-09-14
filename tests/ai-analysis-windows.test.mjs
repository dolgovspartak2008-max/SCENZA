import test from 'node:test';
import assert from 'node:assert/strict';

const candidate = (start, end, score = 80) => ({ start, end, duration: end - start, score, title: 'Момент', description: 'Событие в видео', hook: 'Начало', category: 'Разговор', reason: 'Завершённый эпизод', recommended_format: '9:16', recommended_editing: [] });
async function helpers() {
  let module;
  try { module = await import('../server/ai/analysis.mjs'); } catch {}
  assert.equal(typeof module?.analysisWindows, 'function', 'analysis windows must exist');
  return module;
}

test('two-hour timeline is fully covered and every boundary-crossing 120-second clip fits a window', async () => {
  const { analysisWindows } = await helpers();
  const windows = analysisWindows(7200);
  assert.deepEqual(windows.map(({ start, end }) => [start, end]), [[0, 1800], [1680, 3480], [3360, 5160], [5040, 6840], [6720, 7200]]);
  assert.equal(analysisWindows(1800).length, 1);
  assert.equal(analysisWindows(1800.1).length, 2);
  for (let start = 0; start <= 7080; start += 1) assert.ok(windows.some(window => window.start <= start && window.end >= start + 120));
  for (const duration of [0, -1, Infinity, NaN, '7200', 43201]) assert.throws(() => analysisWindows(duration), /duration/i);
});

test('window metadata clips and rebases transcript words and scenes without mutating the full analysis', async () => {
  const { windowMetadata } = await helpers();
  const analysis = {
    segments: [{ start: 1670, end: 1700, text: 'До границы и после', words: [{ start: 1670, end: 1675, word: 'До' }, { start: 1685, end: 1690, word: 'после' }] }, { start: 3500, end: 3510, text: 'Снаружи' }],
    scenes: [{ start: 1600, end: 1750 }, { start: 1750, end: 3500 }],
  };
  const original = structuredClone(analysis);
  const metadata = windowMetadata(analysis, { start: 1680, end: 3480 });
  assert.deepEqual(metadata.scenes, [{ start: 0, end: 70 }, { start: 70, end: 1800 }]);
  assert.equal(metadata.transcript.length, 1);
  assert.deepEqual(metadata.transcript[0].words, [{ start: 5, end: 10, word: 'после' }]);
  assert.equal(metadata.transcript[0].start, 0);
  assert.equal(metadata.transcript[0].end, 20);
  assert.deepEqual(analysis, original);
  for (const window of [{ start: NaN, end: 1800 }, { start: -1, end: 1800 }, { start: 100, end: 99 }, { start: 0, end: 1801 }]) {
    assert.throws(() => windowMetadata(analysis, window), /window/i);
  }
});

test('a failed cache save stops processing and does not mark a window as durably complete', async () => {
  const { analyzeLongVideo } = await helpers();
  const cache = []; let calls = 0;
  await assert.rejects(() => analyzeLongVideo({
    duration: 3600, analysis: {}, cache,
    async analyze() { calls++; return { candidates: [], model: 'test-provider' }; },
    async persist() { throw new Error('disk unavailable'); },
  }), /disk unavailable/);
  assert.equal(calls, 1);
  assert.equal(cache.length, 0);
});

test('candidate merge restores global timestamps, rejects invalid ranges, deduplicates overlap and keeps the best fifteen', async () => {
  const { mergeWindowCandidates } = await helpers();
  const merged = mergeWindowCandidates([
    { start: 0, end: 1800, candidates: [candidate(1690, 1750, 70), ...Array.from({ length: 15 }, (_, i) => candidate(i * 100, i * 100 + 20, i + 1))].slice(0, 15) },
    { start: 1680, end: 3480, candidates: [candidate(12, 72, 99), candidate(500, 520, 95), candidate(800, 820, 94)] },
  ]);
  assert.equal(merged.length, 15);
  assert.deepEqual([merged[0].start, merged[0].end], [1692, 1752]);
  assert.equal(merged[0].score, 99);
  assert.equal(merged.some(item => item.start === 1690), false);
  assert.ok(merged.every((item, index) => index === 0 || merged[index - 1].score >= item.score));
  for (const item of [candidate(-1, 10), candidate(1790, 1810), candidate(10, 131), candidate(2, 1), candidate(NaN, 10)]) {
    assert.throws(() => mergeWindowCandidates([{ start: 1680, end: 3480, candidates: [item] }]));
  }
});

test('successful windows are durably cached before the next request and retries skip completed model calls', async () => {
  const { analyzeLongVideo } = await helpers();
  const cache = [], calls = [], saves = [], progress = [];
  let failure = true;
  const options = {
    duration: 3600, analysis: { segments: [], scenes: [] }, cache,
    async analyze(window) {
      calls.push(window.start);
      if (window.start === 1680 && failure) throw new Error('model unavailable');
      return { candidates: [candidate(10, 50)], model: 'test-provider' };
    },
    async persist() { saves.push(structuredClone(cache)); },
    async onProgress(value) { progress.push(value); },
  };
  await assert.rejects(() => analyzeLongVideo(options), /model unavailable/);
  assert.equal(cache.length, 1);
  assert.equal(saves[0][0].start, 0);
  failure = false;
  const result = await analyzeLongVideo(options);
  assert.deepEqual(calls, [0, 1680, 1680, 3360]);
  assert.equal(cache.length, 3);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.model, 'test-provider');
  assert.deepEqual(progress.at(-1), { completed: 3, total: 3 });
  assert.deepEqual(result.candidates.map(item => item.start), [10, 1690, 3370]);
});
