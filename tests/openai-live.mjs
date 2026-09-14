// Opt-in smoke check: one paid OpenRouter request, key read from stdin, no saved credentials or API output.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { OpenRouterProvider } from '../server/ai/openai.mjs';
import { validateCandidates } from '../server/ai/gemini.mjs';
import { inspect, run } from '../server/ai/render.mjs';

const input = createInterface({ input: process.stdin, terminal: false });
let key = '';
for await (const line of input) { key = line.trim(); input.close(); break; }
if (!key) throw new Error('Pass the API key through stdin.');
const root = path.resolve('.scena/test-ai');
await mkdir(root, { recursive: true });
const folder = await mkdtemp(path.join(root, 'luna-live-'));
try {
  const filePath = path.resolve('public/videos/platform-example-5958.mp4');
  const { duration, hasAudio } = await inspect(filePath);
  const analysisPath = path.join(folder, 'analysis.json');
  const python = process.env.SCENZA_PYTHON || path.resolve('.scena/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  process.env.HF_HUB_OFFLINE = '1'; process.env.TRANSFORMERS_OFFLINE = '1';
  await run(python, ['server/ai/media.py', hasAudio ? 'analyze' : 'inspect', '--input', filePath, '--output', analysisPath], { timeout: 120000 });
  const analysis = JSON.parse(await readFile(analysisPath, 'utf8'));
  let captured;
  const client = new OpenRouterProvider({ apiKey: 'capture-only', fetcher: async (url, options) => {
    captured = { url, options };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"candidates":[]}' } }] });
  } });
  await client.analyzeVideo({ filePath, duration, transcript: analysis.segments || [], scenes: analysis.scenes || [] });
  assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
  const response = await fetch(captured.url, { ...captured.options, signal: AbortSignal.timeout(180000), headers: { ...captured.options.headers, Authorization: `Bearer ${key}` } });
  key = '';
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = /^[a-z_]+$/.test(body?.error?.code || '') ? body.error.code : 'unavailable';
    console.log(JSON.stringify({ ok: false, httpStatus: response.status, code, requests: 1 }));
    process.exitCode = 1;
  } else {
    const body = await response.json();
    assert.equal(body.choices?.[0]?.finish_reason, 'stop');
    const text = body.choices[0].message.content;
    const candidates = validateCandidates(JSON.parse(text), duration);
    console.log(JSON.stringify({ ok: true, model: body.model, candidates: candidates.length, duration, inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens, requests: 1 }));
  }
} catch {
  key = '';
  console.log('Live check could not complete; no credentials or provider response were logged.');
  process.exitCode = 1;
} finally {
  key = '';
  assert.ok(folder.startsWith(root + path.sep));
  await rm(folder, { recursive: true, force: true });
}
