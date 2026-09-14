import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { OpenRouterProvider } from '../server/ai/openai.mjs';
import { analyzeLongVideo } from '../server/ai/analysis.mjs';
import { ff, normalizeSettings } from '../server/ai/render.mjs';

const candidate = (start = 0, end = 60) => ({ start, end, duration: end - start, segments: [{ start, end }], story: { setup: 'Вопрос', development: 'Объяснение', payoff: 'Ответ', ending: 'Вывод' }, keywords: [], title: 'История', description: 'Полная мысль', hook: 'Вопрос', category: 'Обучение', score: 90, reason: 'Завершённая история', recommended_format: '9:16', recommended_editing: [] });
const response = data => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 } });

test('deep analysis and text edits route independently and permit configured models', async () => {
  const records = [], requests = [];
  const ai = new OpenRouterProvider({ apiKey: 'test', model: 'google/gemini-3.8-flash', editModel: 'google/gemini-3.5-flash-lite', onUsage: record => records.push(record), fetcher: async (_, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    return response(body.model.includes('lite') ? { patch: { format: '1:1', muted: true } } : { candidates: [candidate()] });
  } });
  await ai.selectStories({ duration: 600, candidates: [candidate()], transcript: [] });
  await ai.interpretEditRequest({ request: 'Сделай квадратным и выключи звук', settings: normalizeSettings({}, 60), duration: 600, transcript: [{ start: 550, end: 560, text: 'Unrelated long source text' }] });
  assert.deepEqual(requests.map(item => item.model), ['google/gemini-3.8-flash', 'google/gemini-3.5-flash-lite']);
  assert.ok(requests[1].messages.every(message => !JSON.stringify(message).includes('Unrelated long source text')));
  assert.deepEqual(records.map(item => item.model), requests.map(item => item.model));
  assert.ok(records.every(item => item.cost === 0.001));
  assert.equal(new OpenRouterProvider({ model: 'google/another-video-model' }).model, 'google/another-video-model');
});

test('explicit advertisement placement is retained when a compound edit response omits it', async () => {
  const ai = new OpenRouterProvider({ apiKey: 'test', fetcher: async () => response({ patch: { subtitleSize: 52, ad: { position: 'bottom', start: 5, duration: 3 } } }) });
  const patch = await ai.interpretEditRequest({ request: 'Сделай субтитры размером 52, рекламу поставь справа снизу с 5-й секунды на 3 секунды.', settings: normalizeSettings({}, 60), duration: 90, ad: { position: 'bottom', start: 0, duration: 2, width: 40, opacity: 1 } });
  assert.equal(patch.ad.position, 'bottom-right');
  assert.equal(patch.ad.start, 5);
  assert.equal(patch.ad.duration, 3);
});

test('entire video is sent once; final selection uses cached textual evidence only', { timeout: 60000 }, async () => {
  const root = path.resolve('.scena/test-ai'); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, 'two-model-'));
  try {
    const filePath = path.join(folder, 'source.mp4');
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=2:duration=60', '-c:v', 'libx264', filePath]);
    const calls = [];
    const ai = new OpenRouterProvider({ apiKey: 'test', fetcher: async (_, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      return response(calls.length === 1 ? { overview: { summary: 'Всё видео', events: [{ start: 0, end: 60, description: 'Полная история' }] }, candidates: [candidate()] } : { candidates: [candidate()] });
    } });
    const cache = [];
    const input = { duration: 60, analysis: { segments: [] }, cache, persist: async () => {}, summarize: () => ai.summarizeVideo({ filePath, duration: 60 }), analyze: () => { throw new Error('Must reuse candidates from complete video pass'); }, select: data => ai.selectStories(data) };
    const result = await analyzeLongVideo(input);
    assert.equal(result.candidates.length, 1);
    assert.equal(calls.length, 2);
    const video = calls[0].messages[1].content.find(part => part.type === 'video_url');
    assert.match(video?.video_url.url || '', /^data:video\/mp4;base64,/);
    assert.ok(calls[1].messages[1].content.every(part => part.type === 'text'));
    await analyzeLongVideo(input);
    assert.equal(calls.length, 2, 'retry must reuse final selection too');
  } finally { assert.ok(folder.startsWith(root + path.sep)); await rm(folder, { recursive: true, force: true }); }
});

test('invalid video output never triggers an automatic second full-source request', async () => {
  const root = path.resolve('.scena/test-ai'); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, 'no-repeat-'));
  try {
    const filePath = path.join(folder, 'source.mp4');
    await ff(['-f', 'lavfi', '-i', 'color=size=160x90:rate=2:duration=1', '-c:v', 'libx264', filePath]);
    let calls = 0;
    const ai = new OpenRouterProvider({ apiKey: 'test', fetcher: async () => { calls++; return response({ candidates: [{ nonsense: true }] }); } });
    await assert.rejects(ai.summarizeVideo({ filePath, duration: 1 }), { code: 'AI_INVALID_RESPONSE' });
    assert.equal(calls, 1);
  } finally { assert.ok(folder.startsWith(root + path.sep)); await rm(folder, { recursive: true, force: true }); }
});
