import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from '../server/index.mjs';
import { createWorker } from '../server/ai/worker.mjs';
import { ff } from '../server/ai/render.mjs';

// A 21-minute source must stop at preprocessing: no proxy, no analysis and no tokens charged.
test('a source longer than 20 minutes is refused before analysis and charges nothing', { timeout: 180000 }, async () => {
  const root = path.resolve('.scena/test-ai');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'length-limit-'));
  const keys = ['OPENROUTER_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  let server;
  try {
    const source = path.join(dataDir, 'long.mp4');
    await ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1', '-t', String(21 * 60), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], { timeout: 120000 });
    const input = await readFile(source);
    server = await createServer({ dataDir, seed: false });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = async (route, { body, ...options } = {}) => {
      const response = await fetch(base + route, { ...options, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
      return { response, data: await response.json() };
    };
    assert.equal((await api('/api/video/config')).data.maxSourceSeconds, 1200);
    const created = await api('/api/video/projects', { method: 'POST', body: { name: 'long.mp4', size: input.length } });
    const route = `/api/video/projects/${created.data.project.id}`;
    assert.equal((await api(`${route}/upload`, { method: 'PUT', body: input, headers: { 'Upload-Offset': '0' } })).response.status, 200);
    assert.equal((await api(`${route}/complete`, { method: 'POST' })).response.status, 202);
    const before = (await api('/api/video/usage')).data.tokens;
    const worker = await createWorker({ dataDir, env: {}, provider: { configured: true, analyzeVideo: () => assert.fail('AI must not be called') } });
    assert.equal(await worker.once(), true);
    const { project } = (await api(route)).data;
    assert.equal(project.status, 'FAILED');
    assert.match(project.error, /длиннее 20 минут/);
    assert.equal(await worker.once(), false, 'no analysis job is queued after the refusal');
    assert.equal((await api(`${route}/analyze`, { method: 'POST' })).response.status, 413);
    if (before !== undefined) assert.equal((await api('/api/video/usage')).data.tokens, before, 'no tokens charged');
  } finally {
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(dataDir, { recursive: true, force: true });
  }
});
