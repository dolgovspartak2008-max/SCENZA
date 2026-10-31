import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRange, phasesTime, remaining } from '../src/ai-progress.ts';

const rates = { preprocess: { low: .05, high: .1, samples: 5 }, transcribe: { low: .3, high: .5, samples: 5 }, analyze: { low: .2, high: .4, samples: 5 }, clips: { low: .1, high: .2, samples: 5 }, render: { low: 1, high: 2, samples: 4 } };

test('estimates come only from measured history and scale with the video length', () => {
  assert.deepEqual(phasesTime(rates, ['preprocess', 'transcribe', 'analyze', 'clips'], 600), { low: 390, high: 720 });
  assert.deepEqual(phasesTime(rates, ['preprocess'], 1200), { low: 60, high: 120 });
  assert.equal(phasesTime({ preprocess: rates.preprocess }, ['preprocess', 'transcribe'], 600), null);
  assert.equal(phasesTime(rates, ['render'], 600, 0), null);
  assert.deepEqual(phasesTime(rates, ['render'], 600, 60), { low: 60, high: 120 });
});

test('remaining time uses measured stage progress and never invents a number', () => {
  const now = Date.parse('2026-11-01T10:01:00Z'), startedAt = '2026-11-01T10:00:00Z';
  const live = remaining({ phase: 'render', startedAt, progress: 50, now, rates: {}, sourceSeconds: 600, clipSeconds: 60 });
  assert.equal(live.live, true); assert.deepEqual(live.range, { low: 51, high: 72 });
  const history = remaining({ phase: 'transcribe', startedAt, progress: null, now, rates, sourceSeconds: 600, next: ['analyze', 'clips'] });
  assert.deepEqual(history.range, { low: 120 + 180, high: 240 + 360 });
  assert.equal(remaining({ phase: 'transcribe', startedAt, now, rates: {}, sourceSeconds: 600 }).range, null);
  const late = remaining({ phase: 'preprocess', startedAt: '2026-11-01T09:00:00Z', now, rates, sourceSeconds: 600 });
  assert.equal(late.delayed, true); assert.equal(late.range, null);
});

test('time is written in plain Russian minutes', () => {
  assert.equal(formatRange({ low: 10, high: 50 }), 'меньше минуты');
  assert.equal(formatRange({ low: 170, high: 180 }), '3 минуты');
  assert.equal(formatRange({ low: 240, high: 420 }), '4–7 минут');
  assert.equal(formatRange({ low: 60, high: 61 }), '1–2 минуты');
});
