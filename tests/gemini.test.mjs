import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

let provider;
try { provider = await import('../server/ai/gemini.mjs'); } catch { /* Assert missing implementation below. */ }

const candidate = (extra = {}) => ({ start: 10, end: 40, duration: 30, title: 'Решение', description: 'Герой принимает решение', hook: 'Обратного пути нет', category: 'dialogue', score: 88, reason: 'Завершённый конфликт', recommended_format: '9:16', recommended_editing: ['Сохранить диалог'], segments: [{ start: 10, end: 40 }], story: { setup: 'Вопрос', development: 'Выбор', payoff: 'Решение', ending: 'Вывод' }, keywords: [], ...extra });
const answer = value => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const remote = { name: 'files/test-video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test-video', state: 'ACTIVE' };
const current = { start: 10, end: 40, cropX: 50, format: '9:16', muted: false, subtitles: true, subtitleStyle: 'Classic', subtitleSize: 54, subtitlePosition: 'bottom', cropMode: 'smart', musicVolume: 0.2, cropSmoothing: 0.5 };

test('Gemini provider exists', () => assert.equal(typeof provider?.GeminiProvider, 'function'));

test('quota errors explain retry timing or daily limit without leaking provider data',async()=>{
  for(const daily of [false,true]) {
    const client=new provider.GeminiProvider({apiKey:'private-key',fetcher:async()=>Response.json({error:{message:'private provider details',details:daily?[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel'}]}]:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'32.4s'}]}},{status:429})});
    await assert.rejects(client.interpretEditRequest({request:'Уменьши музыку на треть',settings:current,duration:100}),error=>error.code==='AI_RATE_LIMITED'&&(daily?/дневной/.test(error.message):/33 сек/.test(error.message))&&!/private/.test(error.message));
  }
});

test('temporary-file cleanup failure cannot discard a successful analysis',async t=>{
  const dir=await mkdtemp(path.resolve('tmp/gemini-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'proxy.mp4');await writeFile(filePath,'proxy');
  const client=new provider.GeminiProvider({apiKey:'test',fetcher:async(url,options)=>{
    if(options.method==='DELETE')return new Response('{}',{status:429});
    if(url.includes(':generateContent'))return answer({candidates:[candidate()]});
    if(options.headers['X-Goog-Upload-Command']==='start')return new Response(null,{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=1'}});
    return Response.json({file:remote});
  }});
  assert.deepEqual((await client.analyzeVideo({filePath,duration:120})).candidates,[candidate()]);
});

test('subtitle colors are validated and explicit colors survive incomplete model patches', async () => {
  const client = new provider.GeminiProvider({ apiKey: 'test', fetcher: async () => answer({ patch: { subtitleSize: 72 } }) });
  const patch = await client.interpretEditRequest({ request: 'Сделай субтитры побольше, музыку потише и поменяй цвет текста на жёлтый', settings: current, duration: 100 });
  assert.equal(patch.subtitleSize, 72); assert.equal(patch.subtitleColor, '#FFFF00');
  for (const subtitleColor of ['red', '#fff', '#12345678', '&H00123456', '#12ZZ56', null]) assert.throws(() => provider.validateEditPatch({ subtitleColor }, current, 100));
  assert.equal(provider.validateEditPatch({ subtitleColor: '#Ab12Ef' }, current, 100).subtitleColor, '#Ab12Ef');
});

test('simple subtitle size and color requests avoid AI quota without partial compound edits', async () => {
  let calls = 0;
  const client = new provider.GeminiProvider({ apiKey: 'test', fetcher: async () => { calls++; return new Response('{}', { status: 429 }); } });
  for (const [request, expected] of [
    ['Сделай субтитры побольше', { subtitleSize: 66 }],
    ['Поменяй цвет текста на красный', { subtitleColor: '#FF0000' }],
    ['Сделай субтитры побольше и поменяй цвет текста на жёлтый', { subtitleSize: 66, subtitleColor: '#FFFF00' }],
    ['Сделай субтитры чуть побольше, чтобы их было видно и сделай их желтым цветом', { subtitleSize: 66, subtitleColor: '#FFFF00' }],
    ['Сделай размер субтитров 72. Поменяй цвет текста на #12abEF.', { subtitleSize: 72, subtitleColor: '#12ABEF' }],
    ['Сделай размер субтитров 54 и поменяй цвет текста на красный', { subtitleSize: 54, subtitleColor: '#FF0000' }],
  ]) assert.deepEqual(await client.interpretEditRequest({ request, settings: current, duration: 100 }), expected);
  assert.equal(calls, 0, 'fully understood subtitle requests do not need the provider');
  for (const request of ['Сделай субтитры побольше и добавь салют', 'Не меняй цвет текста на красный', 'Поменяй цвет текста на #fff', 'Сделай размер субтитров 120']) await assert.rejects(client.interpretEditRequest({ request, settings: current, duration: 100 }));
  await assert.rejects(client.interpretEditRequest({ request: 'Сделай субтитры побольше', settings: { ...current, subtitleSize: 96 }, duration: 100 }), /96/);
});

test('unsupported compound edits cannot silently apply just the subtitle color', async () => {
  const client = new provider.GeminiProvider({ apiKey: 'test', fetcher: async () => answer({ patch: {} }) });
  assert.deepEqual(await client.interpretEditRequest({ request: 'Поменяй цвет текста на красный и добавь салют', settings: current, duration: 100 }), {});
});

test('moving subtitles between named positions preserves the models destination', async () => {
  const client=new provider.GeminiProvider({apiKey:'test',fetcher:async()=>answer({patch:{subtitlePosition:'bottom'}})});
  const patch=await client.interpretEditRequest({request:'Опусти субтитры с верхней части в нижнюю.',settings:{...current,subtitlePosition:'top'},duration:100});
  assert.equal(patch.subtitlePosition,'bottom');
});

test('explicit subtitle position is honored when the model omits part of a compound instruction', async () => {
  const client = new provider.GeminiProvider({apiKey:'test',fetcher:async()=>answer({patch:{subtitleSize:40}})});
  const patch=await client.interpretEditRequest({request:'Сделай субтитры меньше: размер 40 вместо 54. Перенеси субтитры выше, в верхнюю часть кадра. Остальные настройки не меняй.',settings:current,duration:100});
  assert.equal(patch.subtitleSize,40);assert.equal(patch.subtitlePosition,'top');
  const unchanged=await client.interpretEditRequest({request:'Сделай размер субтитров 40. Не перемещай субтитры наверх.',settings:current,duration:100});
  assert.equal(unchanged.subtitlePosition,undefined);
});

test('temporary model overload uses fallback, permission errors do not', async () => {
  const models = [];
  const client = new provider.GeminiProvider({ apiKey: 'test-key', model:'gemini-3.8-flash', fallbackModel:'gemini-3.5-flash', fetcher: async url => {
    models.push(url);
    return models.length === 1 ? new Response('{}', {status:503}) : answer({patch:{subtitleSize:40}});
  }});
  assert.deepEqual(await client.interpretEditRequest({request:'Уменьши субтитры для этой сцены',settings:current,duration:100}),{subtitleSize:40});
  assert.equal(models.length,2);assert.match(models[1],/gemini-3\.5-flash:generateContent/);
  let requests=0;
  const denied=new provider.GeminiProvider({apiKey:'test-key',fetcher:async()=>{requests++;return new Response('{}',{status:403});}});
  await assert.rejects(()=>denied.interpretEditRequest({request:'Уменьши субтитры для этой сцены',settings:current,duration:100}));
  assert.equal(requests,1);
});

test('uploads proxy bytes, waits for ACTIVE, analyzes video using JSON schema, deletes remote file', async t => {
  assert.ok(provider);
  const dir = await mkdtemp(path.resolve('tmp/gemini-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'proxy.mp4');
  await writeFile(filePath, 'proxy-bytes');
  const calls = [];
  const gemini = new provider.GeminiProvider({ apiKey: 'server-secret', fetcher: async (url, options) => {
    calls.push({ url, options });
    assert.ok(!url.includes('server-secret'));
    if (calls.length === 1) {
      assert.equal(options.headers['X-Goog-Upload-Header-Content-Length'], '11');
      return new Response(null, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=123' } });
    }
    if (calls.length === 2) {
      assert.equal(await new Response(options.body).text(), 'proxy-bytes');
      return Response.json({ file: { ...remote, state: 'PROCESSING' } });
    }
    if (options.method === 'GET') return Response.json(remote);
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    assert.equal(options.headers['x-goog-api-key'], 'server-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].file_data.file_uri, remote.uri);
    assert.equal(body.contents[0].parts[0].media_processing, 'AGENTIC');
    assert.equal(body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
    assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
    assert.equal(body.generationConfig.responseFormat.text.schema.properties.candidates.maxItems, undefined);
    assert.equal(body.generationConfig.responseFormat.text.schema.properties.candidates.items.properties.start.maximum, undefined);
    return answer({ candidates: [candidate()] });
  } });
  const result = await gemini.analyzeVideo({ filePath, duration: 1200, transcript: [{ start: 10, end: 40, text: 'Текст речи' }], scenes: [0, 10, 40] });
  assert.equal(result.model, 'gemini-3.8-flash');
  assert.deepEqual(result.candidates, [candidate()]);
  assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('untrusted candidate JSON rejects unsafe timestamps, impossible durations and excess candidates', () => {
  assert.ok(provider);
  for (const patch of [{ start: -1 }, { end: 121, start: 0 }, { start: '10' }, { score: Infinity }, { duration: 31 }, { recommended_format: '4:3' }]) {
    assert.throws(() => provider.validateCandidates({ candidates: [candidate(patch)] }, 120));
  }
  assert.throws(() => provider.validateCandidates({ candidates: Array(16).fill(candidate()) }, 120));
  assert.deepEqual(provider.validateCandidates({ candidates: [] }, 120), []);
  const sanitized = provider.validateCandidates({ candidates: [candidate({ command: 'evil' })] }, 120);
  assert.equal(sanitized[0].command, undefined);
});

test('analysis retries an invalid answer once using the same uploaded video', async t => {
  const dir = await mkdtemp(path.resolve('tmp/gemini-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'proxy.mp4');
  await writeFile(filePath, 'proxy');
  for (const firstAnswer of [
    () => answer({ candidates: [candidate({ segments: [{ start: 10, end: 130 }] })] }),
    () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"candidates":[' }] } }] }),
    () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'invalid JSON' }] } }] }),
  ]) {
    let uploads = 0, generations = 0, deletions = 0;
    const gemini = new provider.GeminiProvider({ apiKey: 'test', fetcher: async (url, options) => {
      if (options.method === 'DELETE') { deletions++; return new Response(null, { status: 204 }); }
      if (url.includes(':generateContent')) {
        generations++;
        if (generations === 1) return firstAnswer();
        const body = JSON.parse(options.body);
        assert.match(body.contents[0].parts.at(-1).text, /previous response/i);
        return answer({ candidates: [candidate()] });
      }
      if (options.headers['X-Goog-Upload-Command'] === 'start') {
        uploads++;
        return new Response(null, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=1' } });
      }
      return Response.json({ file: remote });
    } });
    assert.deepEqual((await gemini.analyzeVideo({ filePath, duration: 120 })).candidates, [candidate()]);
    assert.equal(generations, 2);
    assert.equal(uploads, 1);
    assert.equal(deletions, 1);
  }
});

test('invalid candidate errors identify the constraint without leaking source text', () => {
  assert.throws(() => provider.validateCandidates({ candidates: [candidate({ duration: 31, title: 'private source text' })] }, 120),
    error => error.code === 'AI_INVALID_RESPONSE' && /длительность/i.test(error.message) && !error.message.includes('private source text'));
});

test('analysis retry is bounded and blocked content is not retried', async t => {
  const dir = await mkdtemp(path.resolve('tmp/gemini-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'proxy.mp4');
  await writeFile(filePath, 'proxy');
  for (const blocked of [false, true]) {
    let generations = 0, deleted = false;
    const gemini = new provider.GeminiProvider({ apiKey: 'test', fetcher: async (url, options) => {
      if (options.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
      if (url.includes(':generateContent')) {
        generations++;
        return blocked ? Response.json({ promptFeedback: { blockReason: 'SAFETY' } }) : answer({ candidates: [candidate({ segments: [{ start: 10, end: 999 }] })] });
      }
      if (options.headers['X-Goog-Upload-Command'] === 'start') return new Response(null, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=1' } });
      return Response.json({ file: remote });
    } });
    await assert.rejects(gemini.analyzeVideo({ filePath, duration: 120 }),
      error => error.code === (blocked ? 'AI_CONTENT_BLOCKED' : 'AI_INVALID_RESPONSE'));
    assert.equal(generations, blocked ? 1 : 2);
    assert.equal(deleted, true);
  }
});

test('edits send only metadata and permit approved settings patches', async () => {
  assert.ok(provider);
  let calls = 0;
  const gemini = new provider.GeminiProvider({ apiKey: 'secret', fetcher: async (url, options) => {
    calls++;
    assert.ok(url.endsWith(':generateContent'));
    const body = JSON.parse(options.body);
    assert.ok(body.contents[0].parts.every(part => typeof part.text === 'string'));
    assert.equal(body.generationConfig.mediaResolution, undefined);
    return answer({ patch: { subtitleSize: 72, musicVolume: 0.1, cropMode: 'manual' } });
  } });
  const result = await gemini.interpretEditRequest({ request: 'Субтитры крупнее, музыка тише', settings: current, duration: 120, transcript: [], scenes: [] });
  assert.deepEqual(result, { subtitleSize: 72, musicVolume: 0.1, cropMode: 'manual' });
  assert.equal(calls, 1);
});
test('subtitle typo edits use structured literal mappings and retain earlier corrections', async () => {
  const base = { ...current, subtitleReplacements: [{ from: 'Семёнав', to: 'Семёнов' }] };
  const gemini = new provider.GeminiProvider({ apiKey: 'test', fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    const schema = body.generationConfig.responseFormat.text.schema.properties.patch.properties.subtitleReplacements;
    assert.equal(schema.type, 'array'); assert.equal(schema.items.additionalProperties, false);
    assert.ok(body.contents[0].parts[0].text.includes('Семёнав'));
    return answer({ patch: { subtitleReplacements: [{ from: 'Фаме', to: 'Фоме' }] } });
  } });
  const patch = await gemini.interpretEditRequest({ request: 'Замени в субтитрах Фаме на Фоме.', settings: base, duration: 100, transcript: [{ start: 10, end: 11, text: 'Фаме', words: [{ start: 10, end: 11, word: 'Фаме' }] }] });
  assert.deepEqual(patch.subtitleReplacements, [{ from: 'Семёнав', to: 'Семёнов' }, { from: 'Фаме', to: 'Фоме' }]);
  assert.deepEqual(base.subtitleReplacements, [{ from: 'Семёнав', to: 'Семёнов' }]);
  const updated = provider.validateEditPatch({ subtitleReplacements: [{ from: 'Семёнав', to: 'Семёнов!' }] }, base, 100);
  assert.deepEqual(updated.subtitleReplacements, [{ from: 'Семёнав', to: 'Семёнов!' }]);
});
test('subtitle correction schema rejects unexpected keys and invalid mapping sizes', () => {
  const invalid = [[{ from: '', to: 'а' }], [{ from: 'а', to: ' ' }], [{ from: 'а', to: 'б', regex: true }], [{ from: 'а', to: 'б'.repeat(101) }], [{ from: 'а' }], Array.from({ length: 31 }, (_, i) => ({ from: String(i), to: 'а' })), JSON.parse('[{"from":"а","to":"б","__proto__":{}}]')];
  for (const subtitleReplacements of invalid) assert.throws(() => provider.validateEditPatch({ subtitleReplacements }, current, 100));
  const full = { ...current, subtitleReplacements: Array.from({ length: 30 }, (_, i) => ({ from: String(i), to: 'а' })) };
  assert.throws(() => provider.validateEditPatch({ subtitleReplacements: [{ from: 'new', to: 'новое' }] }, full, 100));
});

test('edit validation rejects arbitrary paths, new music IDs, invalid values and clips over two minutes', () => {
  assert.ok(provider);
  for (const patch of [{ filePath: '/etc/passwd' }, { musicId: 'new' }, { musicVolume: -1 }, { subtitleSize: 100 }, { start: 0, end: 121 }, { cropX: NaN }, { subtitleStyle: 'evil' }, { sceneId: 'unknown' }]) {
    assert.throws(() => provider.validateEditPatch(patch, current, 200, []));
  }
  assert.deepEqual(provider.validateEditPatch({ sceneId: 'second' }, current, 200, [{ id: 'second', start: 50, end: 75 }]), { sceneId: 'second', start: 50, end: 75 });
});

test('network errors never expose keys or provider response body', async () => {
  assert.ok(provider);
  for (const fetcher of [async () => { throw new Error('secret https://server?key=secret'); }, async () => new Response('secret', { status: 429 })]) {
    const gemini = new provider.GeminiProvider({ apiKey: 'secret', fetcher });
    await assert.rejects(gemini.interpretEditRequest({ request: 'Тише', settings: current, duration: 120 }), error => !error.message.includes('secret'));
  }
});

test('rejected analysis and cancellation still delete uploaded file', async t => {
  assert.ok(provider);
  const dir = await mkdtemp(path.resolve('tmp/gemini-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'proxy.mp4');
  await writeFile(filePath, 'x');
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const methods = [];
    const gemini = new provider.GeminiProvider({ apiKey: 'secret', fetcher: async (url, options) => {
      methods.push(options.method);
      if (methods.length === 1) return new Response(null, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=1' } });
      if (methods.length === 2) {
        if (cancel) controller.abort();
        return Response.json({ file: remote });
      }
      if (options.method === 'DELETE') { assert.equal(options.signal.aborted, false); return new Response(null, { status: 204 }); }
      return answer({ candidates: [candidate({ segments: [{ start: 10, end: 150 }] })] });
    } });
    await assert.rejects(gemini.analyzeVideo({ filePath, duration: 120, signal: controller.signal }));
    assert.equal(methods.at(-1), 'DELETE');
  }
});

test('upload redirect to a foreign host is rejected before sending proxy or credentials', async t => {
  assert.ok(provider);
  const dir = await mkdtemp(path.resolve('tmp/gemini-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'proxy.mp4');
  await writeFile(filePath, 'x');
  let calls = 0;
  const gemini = new provider.GeminiProvider({ apiKey: 'secret', fetcher: async () => {
    calls++;
    return new Response(null, { headers: { 'x-goog-upload-url': 'https://attacker.test/collect' } });
  } });
  await assert.rejects(gemini.analyzeVideo({ filePath, duration: 120 }));
  assert.equal(calls, 1);
});
