import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidates, validateModelCandidates, validateEditPatch, interpretEditRequest } from '../server/ai/gemini.mjs';
import { frameTimes, OpenRouterProvider, preserveWords } from '../server/ai/openai.mjs';
import { analyzeLongVideo, mergeWindowCandidates } from '../server/ai/analysis.mjs';

const story = { setup: 'Вопрос', development: 'Объяснение', payoff: 'Открытие', ending: 'Вывод' };
const candidate = (segments = [{ start: 10, end: 30 }, { start: 300, end: 320 }]) => ({ start: Math.min(...segments.map(s => s.start)), end: Math.max(...segments.map(s => s.end)), duration: segments.reduce((sum, s) => sum + s.end - s.start, 0), segments, story, keywords: ['открытие'], score: 80, title: 'История', description: 'Завершённая история', hook: 'Вопрос', category: 'Рассказ', reason: 'Есть вывод', recommended_format: '9:16', recommended_editing: [] });

test('story validation measures edited duration, preserves order and rejects fragmentary or overlapping edits', () => {
  const value = candidate([{ start: 300, end: 320 }, { start: 10, end: 30 }]);
  assert.deepEqual(validateCandidates({ candidates: [value] }, 600, { requireStory: true }), [value]);
  for (const invalid of [candidate([{ start: 10, end: 11 }]), candidate([{ start: 10, end: 30 }, { start: 20, end: 40 }]), { ...value, duration: 310 }, { ...value, start: 0 }, { ...value, story: { ...story, ending: '' } }, { ...value, segments: [] }]) {
    assert.throws(() => validateCandidates({ candidates: [invalid] }, 600, { requireStory: true }));
  }
  const { segments, story: _story, keywords, ...legacy } = candidate([{ start: 0, end: 1 }]);
  assert.deepEqual(validateCandidates({ candidates: [legacy] }, 600), [legacy]);
  assert.throws(() => validateCandidates({ candidates: [legacy] }, 600, { requireStory: true }));
});

test('dense frame review samples only edited segments and merge rebases every segment', () => {
  const value = candidate();
  const times = frameTimes(600, [], [value]);
  assert.ok(times.length > 4);
  assert.ok(times.every(t => t >= 5 && t <= 35 || t >= 295 && t <= 325));
  const merged = mergeWindowCandidates([{ start: 1680, end: 3480, candidates: [value] }]);
  assert.deepEqual(merged[0].segments, [{ start: 1690, end: 1710 }, { start: 1980, end: 2000 }]);
});

test('every source window is summarized before story selection and final selection receives global evidence', async () => {
  const calls = [], cache = [];
  const result = await analyzeLongVideo({ duration: 3600, analysis: { segments: [] }, cache, persist: async () => {},
    async summarize(window) { calls.push(`overview:${window.start}`); return { overview: { summary: `Содержание ${window.start}`, events: [{ start: 1, end: 30, description: 'Событие' }] }, model: 'test' }; },
    async analyze(window, metadata, context) { calls.push(`analyze:${window.start}`); assert.equal(context.overview.length, 3); assert.equal(context.overview[1].events[0].start, 1681); return { candidates: [candidate([{ start: 10, end: 40 }])], model: 'test' }; },
    async select(input) { calls.push('select'); assert.equal(input.candidates[1].segments[0].start, 1690); return { candidates: [candidate([{ start: 10, end: 40 }, { start: 1690, end: 1720 }])], model: 'test' }; },
  });
  assert.deepEqual(calls, ['overview:0', 'overview:1680', 'overview:3360', 'analyze:0', 'analyze:1680', 'analyze:3360', 'select']);
  assert.equal(result.candidates[0].duration, 60);
  assert.equal(result.candidates[0].segments.length, 2);
});

test('combined window evidence and final version 3 results are reused without another video or selection request', async () => {
  const calls = [], cache = [{ start: 0, end: 1800, version: 2, overview: { summary: 'Устаревший анализ', events: [] }, candidates: [] }];
  let persists = 0;
  const input = { duration: 3600, analysis: { segments: [] }, cache,
    async persist() { persists++; },
    async summarize(window) {
      calls.push(`video:${window.start}`);
      return { overview: { summary: `Содержание ${window.start}`, events: [{ start: 1, end: 30, description: 'Событие' }] }, candidates: [candidate([{ start: 10, end: 40 }])], model: 'test' };
    },
    async analyze() { assert.fail('Saved first-pass candidates must not trigger a second video analysis'); },
    async select(evidence) {
      calls.push('select');
      assert.deepEqual(evidence.candidates.map(item => item.start), [10, 1690, 3370]);
      assert.deepEqual(evidence.overview.map(item => item.events[0].start), [1, 1681, 3361]);
      return { candidates: [candidate([{ start: 10, end: 40 }, { start: 1690, end: 1720 }])], model: 'test' };
    },
  };
  const result = await analyzeLongVideo(input);
  assert.deepEqual(calls, ['video:0', 'video:1680', 'video:3360', 'select']);
  assert.equal(persists, 4);
  assert.equal(cache.filter(entry => entry.version === 3 && entry.overview && entry.candidates).length, 3);
  assert.deepEqual(cache.at(-1), { kind: 'final', duration: 3600, version: 3, result });
  assert.deepEqual(await analyzeLongVideo(input), result);
  assert.equal(calls.length, 4);
  assert.equal(persists, 4);
});

test('word boundaries and grounded highlights survive every edited source range', () => {
  const input = candidate([{ start: 10.2, end: 30 }, { start: 300, end: 319.7 }]);
  const result = preserveWords([input], [{ start: 10, end: 31, text: 'открытие', words: [{ start: 10, end: 11, word: 'открытие' }] }, { start: 319, end: 320, text: 'вывод', words: [{ start: 319, end: 320, word: 'вывод' }] }], 600)[0];
  assert.deepEqual(result.segments, [{ start: 10, end: 30 }, { start: 300, end: 320 }]);
  assert.equal(result.duration, 40);
  assert.deepEqual(result.keywords, ['открытие']);
  assert.deepEqual(preserveWords([input], [], 600)[0].keywords, []);
  assert.deepEqual(preserveWords([{ ...input, keywords: ['он', 'слон'] }], [{ start: 11, end: 12, text: 'Слон.' }], 600)[0].keywords, ['слон']);
});

test('global story review joins evidenced scenes and refuses new footage or legacy second-long output', async () => {
  let output = candidate();
  const provider = new OpenRouterProvider({ apiKey: 'test', fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'google/gemini-3.8-flash');
    assert.ok(body.messages[1].content.every(part => part.type === 'text'));
    assert.match(body.messages[1].content[0].text, /FULL SOURCE/);
    assert.match(body.messages[1].content[0].text, /best 5–10 DISTINCT complete stories/);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [output] }) } }] });
  } });
  assert.equal(typeof provider.selectStories, 'function');
  const input = { duration: 600, candidates: [candidate([{ start: 10, end: 30 }]), candidate([{ start: 300, end: 320 }])], overview: [], transcript: [] };
  assert.equal((await provider.selectStories(input)).candidates[0].duration, 40);
  output = candidate([{ start: 100, end: 120 }]);
  await assert.rejects(() => provider.selectStories(input), { code: 'AI_INVALID_RESPONSE' });
});

test('global review accepts ten distinct stories but rejects an eleventh and skips empty evidence', async () => {
  const candidates = Array.from({ length: 11 }, (_, index) => candidate([{ start: index * 50, end: index * 50 + 30 }]));
  let count = 10, calls = 0;
  const provider = new OpenRouterProvider({ apiKey: 'test', fetcher: async () => {
    calls++;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: candidates.slice(0, count) }) } }] });
  } });
  const input = { duration: 600, candidates, overview: [], transcript: [] };
  assert.equal((await provider.selectStories(input)).candidates.length, 10);
  count = 11;
  await assert.rejects(provider.selectStories(input), { code: 'AI_INVALID_RESPONSE' });
  assert.deepEqual((await provider.selectStories({ ...input, candidates: [] })).candidates, []);
  assert.equal(calls, 2);
});

test('model arithmetic is derived from segments without weakening source interval validation', async () => {
  let output = { ...candidate(), start: 0, end: 600, duration: 25 };
  const provider = new OpenRouterProvider({ apiKey: 'test', fetcher: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [output] }) } }] }) });
  const input = { duration: 600, candidates: [candidate()], overview: [], transcript: [] };
  const result = (await provider.selectStories(input)).candidates[0];
  assert.deepEqual({ start: result.start, end: result.end, duration: result.duration }, { start: 10, end: 320, duration: 40 });
  assert.throws(() => validateCandidates({ candidates: [output] }, 600, { requireStory: true }), 'persisted candidates remain strictly checked');
  for (const segments of [[{ start: -1, end: 30 }], [{ start: 10, end: 700 }], [{ start: 10, end: 90 }, { start: 20, end: 50 }], [{ start: 10, end: 100 }, { start: 300, end: 350 }]]) {
    output = { ...output, segments };
    await assert.rejects(() => provider.selectStories(input), { code: 'AI_INVALID_RESPONSE' });
  }
});

test('model sentence cuts retain natural pauses as one complete scene without relaxing interval limits', () => {
  const parts = [{ start: 5.65, end: 8.27 }, { start: 8.41, end: 10.63 }, { start: 11.43, end: 14.51 }];
  const result = validateModelCandidates({ candidates: [{ ...candidate(parts), duration: 8.86 }] }, 23.349)[0];
  assert.deepEqual(result.segments, [{ start: 5.65, end: 14.51 }]);
  assert.ok(Math.abs(result.duration - 8.86) < 0.001);
  for (const parts of [[{ start: 5, end: 15 }, { start: 16, end: 25 }], [{ start: 20, end: 30 }, { start: 10, end: 20 }]]) {
    assert.deepEqual(validateModelCandidates({ candidates: [candidate(parts)] }, 600)[0].segments, parts);
  }
  for (const parts of [[{ start: -1, end: 10 }, { start: 10.1, end: 20 }], [{ start: 1, end: 10 }, { start: 9, end: 20 }], [{ start: 1, end: 10 }, { start: 10.1, end: 10.1 }], [{ start: 0, end: 60 }, { start: 60.5, end: 120.4 }]]) {
    assert.throws(() => validateModelCandidates({ candidates: [candidate(parts)] }, 600));
  }
});

test('short model ideas are excluded without losing a valid story or failing the whole analysis', () => {
  const short = candidate([{ start: 18.38, end: 19.06 }]);
  const complete = candidate([{ start: 5.65, end: 14.51 }]);
  assert.throws(() => validateModelCandidates({ candidates: [short, complete] }, 23.349));
  assert.deepEqual(validateModelCandidates({ candidates: [short, complete] }, 23.349, { discardShort: true }), [complete]);
  assert.deepEqual(validateModelCandidates({ candidates: [short] }, 23.349, { discardShort: true }), []);
  assert.throws(() => validateCandidates({ candidates: [short] }, 23.349, { requireStory: true }), error => error.code === 'AI_INVALID_RESPONSE' && /0\.68/.test(error.message));
  assert.throws(() => validateModelCandidates({ candidates: [{ ...short, story: {} }] }, 23.349));
});

test('global selection retries short ideas once before keeping only complete stories', async () => {
  const complete = candidate([{ start: 5.65, end: 14.51 }]);
  let calls = 0;
  const provider = new OpenRouterProvider({ apiKey: 'test', fetcher: async () => {
    calls++;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [candidate([{ start: 18.38, end: 19.06 }]), complete] }) } }] });
  } });
  const result = await provider.selectStories({ duration: 23.349, candidates: [complete], overview: [], transcript: [] });
  assert.equal(calls, 2);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].start, 5.65);
});

test('subtitle edits accept long source envelopes with a short assembled runtime', async () => {
  const settings = { start: 10, end: 320, segments: [{ start: 10, end: 30 }, { start: 300, end: 320 }], subtitleSize: 54 };
  assert.deepEqual(await interpretEditRequest({ request: 'Сделай субтитры побольше', settings, duration: 600 }), { subtitleSize: 66 });
});

test('selecting a complete story carries its assembly and highlights into the edit patch', () => {
  const scene = { id: 'story', ...candidate() };
  const patch = validateEditPatch({ sceneId: 'story' }, { start: 0, end: 30 }, 600, [scene]);
  assert.deepEqual(patch, { sceneId: 'story', start: 10, end: 320, segments: scene.segments, keywords: scene.keywords });
  assert.throws(() => validateEditPatch({ segments: [{ start: 10, end: 90 }, { start: 20, end: 80 }] }, scene, 600));
});
