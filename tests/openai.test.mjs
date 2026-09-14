import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { normalizeSettings, ff } from '../server/ai/render.mjs';

const load = () => import('../server/ai/openai.mjs');
const candidate = (start = 1, end = 11, score = 90) => ({ start, end, duration: end - start, score, title: 'Момент', description: 'Событие', hook: 'Начало', category: 'Рассказ', reason: 'Завершённая мысль', recommended_format: '9:16', recommended_editing: [], segments: [{ start, end }], story: { setup: 'Вопрос', development: 'Выбор', payoff: 'Решение', ending: 'Вывод' }, keywords: [] });
const answer = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });

test('OpenRouter defaults to separate Gemini models and validates configurable model identifiers', async () => {
  const { OpenRouterProvider, PRIMARY_VIDEO_MODEL, FAST_EDIT_MODEL } = await load();
  assert.equal(PRIMARY_VIDEO_MODEL, 'google/gemini-3.8-flash');
  assert.equal(FAST_EDIT_MODEL, 'google/gemini-3.5-flash-lite');
  const provider = new OpenRouterProvider({ apiKey: 'test' });
  assert.equal(provider.model, PRIMARY_VIDEO_MODEL);
  assert.equal(provider.editModel, FAST_EDIT_MODEL);
  const custom = new OpenRouterProvider({ apiKey: 'test', model: 'google/gemini-2.5-flash', editModel: 'google/gemini-2.5-flash-lite' });
  assert.equal(custom.model, 'google/gemini-2.5-flash');
  assert.equal(custom.editModel, 'google/gemini-2.5-flash-lite');
  for (const key of ['model', 'editModel']) for (const value of ['', 'gemini', 'google/model extra', 'https://example.com/model', null]) {
    assert.throws(() => new OpenRouterProvider({ apiKey: 'test', [key]: value }), { code: 'AI_CONFIG_ERROR' });
  }
});

test('frame sampling covers the full timeline and short scenes, with bounded dense review', async () => {
  const { frameTimes } = await load();
  const times = frameTimes(1800, [{ start: 71, end: 72 }]);
  assert.ok(times.length <= 200);
  assert.ok(times[0] < 1 && times.at(-1) > 1798);
  assert.ok(times.includes(71.5));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 15.2);
  const dense = frameTimes(1800, [], [candidate(500, 620), candidate(1100, 1220)]);
  assert.ok(dense.length <= 240 && dense.some(t => t < 500) && dense.some(t => t > 1220));
  assert.ok(dense.every(t => t >= 495 && t <= 625 || t >= 1095 && t <= 1225));
  assert.ok(frameTimes(1800, [], Array.from({ length: 15 }, (_, i) => candidate(i * 120, (i + 1) * 120))).length <= 240);
  for (const duration of [0, -1, NaN, 1801]) assert.throws(() => frameTimes(duration, []));
});

test('Gemini Lite edit request uses authenticated OpenRouter API and preserves sparse patches', async () => {
  const { OpenRouterProvider } = await load();
  let calls = 0;
  const ai = new OpenRouterProvider({ apiKey: 'test-private-key', fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-private-key');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'google/gemini-3.5-flash-lite');
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.response_format.json_schema.strict, true);
    const patch = body.response_format.json_schema.schema.properties.patch;
    assert.equal(patch.required, undefined);
    assert.equal(patch.additionalProperties, false);
    assert.ok(!options.body.includes('test-private-key'));
    return answer({ patch: { format: '1:1', muted: true, subtitleColor: null } });
  } });
  const settings = normalizeSettings({}, 60);
  assert.deepEqual(await ai.interpretEditRequest({ request: 'Сделай квадратным и отключи звук', settings, duration: 120 }), { format: '1:1', muted: true });
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(ai).includes('test-private-key'));
});

test('missing key, quota, refusal, truncation, cancellation and invalid patches fail without leaking secrets', async () => {
  const { OpenRouterProvider } = await load();
  const input = { request: 'Сделай квадратным', settings: normalizeSettings({}, 60), duration: 120 };
  for (const [response, code] of [
    [() => Response.json({ error: { message: 'secret' } }, { status: 429 }), 'AI_RATE_LIMITED'],
    [() => Response.json({ error: { message: 'secret' } }, { status: 401 }), 'AI_PROVIDER_ERROR'],
    [() => Response.json({ error: { message: 'secret' } }, { status: 402 }), 'AI_PROVIDER_ERROR'],
    [() => Response.json({ choices: [{ finish_reason: 'content_filter', message: { refusal: 'secret' } }] }), 'AI_CONTENT_BLOCKED'],
    [() => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), 'AI_INVALID_RESPONSE'],
    [() => answer({ patch: { start: 100 } }), 'AI_INVALID_RESPONSE'],
    [() => answer({ patch: { filePath: '/secret' } }), 'AI_INVALID_RESPONSE'],
  ]) {
    let calls = 0;
    const ai = new OpenRouterProvider({ apiKey: 'secret', fetcher: async () => { calls++; return response(); } });
    await assert.rejects(ai.interpretEditRequest(input), error => error.code === code && !error.message.includes('secret'));
    assert.ok(calls <= 2);
    if (code !== 'AI_INVALID_RESPONSE') assert.equal(calls, 1);
  }
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('secret'); };
  await assert.rejects(new OpenRouterProvider({ apiKey: '', fetcher }).interpretEditRequest(input), { code: 'AI_NOT_CONFIGURED' });
  await assert.rejects(new OpenRouterProvider({ apiKey: 'secret', fetcher }).interpretEditRequest({ ...input, signal: AbortSignal.abort() }), { code: 'AI_CANCELLED' });
  assert.equal(calls, 0);
});

test('API readiness and analysis queue require the OpenRouter key, not previous provider keys', async () => {
  const { createVideoApi } = await import('../server/ai/api.mjs');
  const { createStore } = await import('../server/ai/store.mjs');
  const root = path.resolve('.scena/test-ai'); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, 'luna-api-'));
  const env = { GEMINI_API_KEY: 'previous-private-key', OPENAI_API_KEY: 'previous-private-key' };
  const api = await createVideoApi({ dataDir: folder, env });
  const store = await createStore({ dataDir: path.join(folder, 'ai'), env: {} });
  let body;
  const response = { writeHead() {}, end(value) { body = JSON.parse(value); } };
  const request = { method: 'POST', url: '/api/video/projects/luna-project/analyze' };
  try {
    await store.saveProject('owner', { id: 'luna-project', status: 'READY', files: { original: { key: 'original.mp4' } }, candidates: [] });
    await api.handle({ method: 'GET', url: '/api/video/config' }, response, 'owner');
    assert.equal(body.aiReady, false);
    await assert.rejects(api.handle(request, response, 'owner'), { status: 503 });
    env.OPENROUTER_API_KEY = 'new-private-key';
    await api.handle({ method: 'GET', url: '/api/video/config' }, response, 'owner');
    assert.equal(body.aiReady, true);
    assert.ok(!JSON.stringify(body).includes('private-key'));
    await api.handle(request, response, 'owner');
    assert.equal(body.job.type, 'analyze');
    env.OPENROUTER_API_KEY = '   ';
    await api.handle({ method: 'GET', url: '/api/video/config' }, response, 'owner');
    assert.equal(body.aiReady, false);
  } finally { await api.close(); await store.close(); assert.ok(folder.startsWith(root + path.sep)); await rm(folder, { recursive: true, force: true }); }
});

test('full video is sent once; metadata review refines and deduplicates while summaries retain candidates', { timeout: 60000 }, async () => {
  const { OpenRouterProvider } = await load();
  const root = path.resolve('.scena/test-ai'); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, 'luna-'));
  try {
    const filePath = path.join(folder, 'input.mp4');
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=2:duration=12', '-c:v', 'libx264', filePath]);
    const video = await readFile(filePath);
    const overview = { summary: 'Полная сцена', events: [{ start: 0, end: 12, description: 'Содержание всей сцены' }] };
    let calls = 0;
    const ai = new OpenRouterProvider({ apiKey: 'test', fetcher: async (_url, options) => {
      const body = JSON.parse(options.body), content = body.messages[1].content;
      assert.doesNotMatch(JSON.stringify(body.response_format.json_schema.schema), /"(?:minimum|maximum|minLength|maxLength|minItems|maxItems)":/);
      assert.equal(body.model, 'google/gemini-3.8-flash');
      assert.ok(content.every(item => item.type !== 'image_url'));
      assert.match(JSON.stringify(content), /Реплика/);
      calls++;
      if (calls === 1) {
        assert.deepEqual(body.response_format.json_schema.schema.required, ['overview', 'candidates']);
        const videos = content.filter(item => item.type === 'video_url');
        assert.equal(videos.length, 1);
        assert.ok(videos[0].video_url.url.startsWith('data:video/mp4;base64,'));
        assert.deepEqual(Buffer.from(videos[0].video_url.url.split(',')[1], 'base64'), video);
        return answer({ overview, candidates: [candidate()] });
      }
      if (calls === 2) {
        assert.ok(content.every(item => item.type === 'text'));
        assert.match(content[0].text, /"start":0\.5/);
        assert.match(content[0].text, /"end":11\.5/);
      }
      return answer({ candidates: [candidate(0.5, 11.5, 95), candidate(0.6, 11.4, 80)] });
    } });
    const result = await ai.analyzeVideo({ filePath, duration: 12, transcript: [{ start: 0.5, end: 11.5, text: 'Реплика целиком.', words: [{ start: 0.5, end: 1.5, word: 'Реплика' }, { start: 10.5, end: 11.5, word: 'целиком.' }] }], scenes: [{ start: 0, end: 12 }] });
    assert.equal(calls, 2);
    assert.equal(result.model, 'google/gemini-3.8-flash');
    assert.deepEqual(result.candidates, [candidate(0.5, 11.5, 95)]);
    assert.deepEqual(result.overview, overview);
    assert.deepEqual(result.initialCandidates, [candidate(0.5, 11.5)]);
    assert.deepEqual(await readdir(folder), ['input.mp4']);
    let summaryCalls = 0;
    const summarizer = new OpenRouterProvider({ apiKey: 'test', fetcher: async (_url, options) => {
      summaryCalls++;
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.some(part => part.type === 'video_url'));
      assert.match(body.messages[1].content[0].text, /BEFORE choosing clips/);
      return answer({ overview, candidates: [candidate()] });
    } });
    assert.deepEqual(await summarizer.summarizeVideo({ filePath, duration: 12 }), { overview, candidates: [candidate()], model: 'google/gemini-3.8-flash' });
    assert.equal(summaryCalls, 1);
    assert.deepEqual(await readdir(folder), ['input.mp4']);
    const audioTail = path.join(folder, 'audio-tail.mp4');
    await ff(['-i', filePath, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'copy', '-c:a', 'aac', audioTail]);
    let tailCalls = 0;
    const tail = new OpenRouterProvider({ apiKey: 'test', fetcher: async (_url, options) => {
      tailCalls++;
      const body = JSON.parse(options.body);
      assert.match(JSON.stringify(body.messages), /visualDuration/);
      return answer({ overview, candidates: [] });
    } });
    assert.deepEqual((await tail.analyzeVideo({ filePath: audioTail, duration: 12 })).candidates, []);
    assert.equal(tailCalls, 1);
    const cancelled = new OpenRouterProvider({ apiKey: 'test', fetcher: async () => { throw new Error('Should not call'); } });
    await assert.rejects(cancelled.analyzeVideo({ filePath, duration: 12, signal: AbortSignal.abort() }), { code: 'AI_CANCELLED' });
    assert.deepEqual((await readdir(folder)).sort(), ['audio-tail.mp4', 'input.mp4']);
    assert.ok((await readFile(filePath)).length > 0);
  } finally { assert.ok(folder.startsWith(root + path.sep)); await rm(folder, { recursive: true, force: true }); }
});
