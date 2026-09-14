// Opt-in paid API check: node --env-file=.env tests/ai-live.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import ffprobe from 'ffprobe-static';
import { createServer } from '../server/index.mjs';
import { createWorker } from '../server/ai/worker.mjs';
import { ff, inspect, run } from '../server/ai/render.mjs';

if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for this opt-in live check.');
const apiKey = process.env.OPENROUTER_API_KEY;
const safe = value => String(value?.message || value).replaceAll(apiKey, '[redacted]').slice(0, 500);
const liveRoot = path.resolve(process.env.SCENZA_LIVE_ROOT || '.scena/live-check');
const resume = process.env.SCENZA_LIVE_RESUME_DIR;
const dataDir = resume ? path.resolve(resume) : path.join(liveRoot, randomUUID());
if (!dataDir.startsWith(liveRoot + path.sep)) throw new Error('Live-check artifacts must stay inside .scena/live-check.');
if (resume && !/^[a-f\d-]{36}$/i.test(process.env.SCENZA_LIVE_PROJECT_ID || '')) throw new Error('SCENZA_LIVE_PROJECT_ID is required when resuming.');
const source = path.resolve('public/videos/platform-example-5958.mp4');
// This check uses a dedicated local database and files even on a configured production host.
for (const key of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) delete process.env[key];
process.env.HF_HUB_OFFLINE = '1'; process.env.TRANSFORMERS_OFFLINE = '1';
let server, worker;
const jobResults = [];
try {
  await mkdir(dataDir, { recursive: true });
  console.log(`Artifacts: ${dataDir}`);
  server = await createServer({ dataDir, seed: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, { body, ...options } = {}) => {
    const response = await fetch(base + route, { ...options, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`Local API HTTP ${response.status}: ${safe(data.error || 'request failed')}`);
    return data;
  };
  const download = async (route, target) => {
    const response = await fetch(base + route);
    if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  };
  let created;
  if (resume) ({ project: created } = await api(`/api/video/projects/${process.env.SCENZA_LIVE_PROJECT_ID}`));
  else {
    const sourceBytes = await readFile(source);
    ({ project: created } = await api('/api/video/projects', { method: 'POST', body: { name: 'live-check.mp4', size: sourceBytes.length } }));
    console.log(`Upload: project ${created.id}, ${sourceBytes.length} bytes`);
    for (let offset = 0; offset < sourceBytes.length; offset += 2 * 1024 ** 2) {
      const end = Math.min(sourceBytes.length, offset + 2 * 1024 ** 2);
      const result = await api(`/api/video/projects/${created.id}/upload`, { method: 'PUT', body: sourceBytes.subarray(offset, end), headers: { 'Upload-Offset': String(offset) } });
      assert.equal(result.offset, end);
    }
  }
  const route = `/api/video/projects/${created.id}`;
  worker = await createWorker({ dataDir, env: process.env });
  const runJob = async (jobId, label) => {
    const started = Date.now();
    console.log(`${label}: started ${jobId}`);
    const timer = setInterval(() => {
      void api(`/api/video/jobs/${jobId}`).then(({ job }) => console.log(`${label}: ${job.stage}, ${job.progress ?? 'pending'}%`)).catch(error => console.log(`${label}: ${safe(error)}`));
    }, 30000);
    try {
      assert.equal(await worker.once(), true, `${label}: no queued job`);
      const { job } = await api(`/api/video/jobs/${jobId}`);
      if (job.status !== 'done') throw new Error(`${label}: ${safe(job.error || job.status)}`);
      const seconds = Math.round((Date.now() - started) / 1000);
      jobResults.push({ type: job.type, id: job.id, seconds, status: job.status });
      console.log(`${label}: done in ${seconds}s`);
    } finally { clearInterval(timer); }
  };
  if (!resume) {
    const complete = await api(`${route}/complete`, { method: 'POST' });
    await runJob(complete.job.id, 'Preprocess');
  }
  let { project } = await api(route);
  if (!project.candidates.length) {
    if (resume && project.status === 'FAILED') await api(`/api/video/jobs/${project.jobId}/retry`, { method: 'POST' });
    else assert.equal(project.status, 'ANALYZING');
    await runJob(project.jobId, 'Real Gemini analysis');
  }
  ({ project } = await api(route));
  assert.ok(['READY', 'AWAITING_APPROVAL', 'APPROVED', 'ADDING_AD', 'COMPLETED'].includes(project.status));
  assert.ok(project.candidates.length > 0, 'Gemini must return at least one valid candidate');
  console.log(`Candidates: ${project.candidates.length}; model: ${project.analysisModel}`);
  const candidate = project.candidates[0];
  const existingVersions = project.versions.length;
  assert.ok(candidate.start >= 0 && candidate.end > candidate.start && candidate.end <= project.duration + .01 && candidate.end - candidate.start <= 120);
  const preview = await api(`${route}/preview`, { method: 'POST', body: { sceneId: candidate.id, settings: { start: candidate.start, end: candidate.end, format: '9:16', subtitles: true, subtitleSize: 54, subtitlePosition: 'bottom', muted: false } } });
  await runJob(preview.job.id, 'Preview');
  ({ project } = await api(route));
  assert.equal(project.status, 'AWAITING_APPROVAL');
  await download(`${route}/files/${project.currentVersion}`, path.join(dataDir, 'preview.mp4'));
  const request = 'Сделай субтитры меньше: размер 40 вместо 54. Перенеси субтитры выше, в верхнюю часть кадра. Остальные настройки не меняй.';
  const revision = await api(`${route}/revise`, { method: 'POST', body: { request } });
  await runJob(revision.job.id, 'Real Gemini edit');
  ({ project } = await api(route));
  assert.equal(project.status, 'AWAITING_APPROVAL');
  assert.equal(project.versions.length, existingVersions + 2);
  assert.equal(project.settings.subtitleSize, 40, 'natural edit must reduce subtitle size');
  assert.equal(project.settings.subtitlePosition, 'top', 'natural edit must move subtitles to the top');
  assert.equal(project.settings.format, '9:16');
  await download(`${route}/files/${project.currentVersion}`, path.join(dataDir, 'revised-preview.mp4'));
  await api(`${route}/approve`, { method: 'POST' });
  const banner = path.join(dataDir, 'banner.png');
  await ff(['-f', 'lavfi', '-i', 'color=c=0x2dd4bf:s=320x80', '-frames:v', '1', banner]);
  const asset = await api(`${route}/advertisement?filename=banner.png`, { method: 'POST', body: await readFile(banner) });
  await runJob(asset.job.id, 'Advertisement asset');
  await api(`${route}/advertisement`, { method: 'PUT', body: { position: 'bottom', width: 40, start: 0, duration: Math.min(2, candidate.end - candidate.start), opacity: 1 } });
  const adPreview = await api(`${route}/ad-preview`, { method: 'POST', body: {} });
  await runJob(adPreview.job.id, 'Advertisement preview');
  ({ project } = await api(route));
  assert.ok(project.adPreview);
  await download(`${route}/files/${project.adPreview}`, path.join(dataDir, 'advertisement-preview.mp4'));
  const exported = await api(`${route}/export`, { method: 'POST', body: {} });
  await runJob(exported.job.id, 'Export');
  ({ project } = await api(route));
  assert.equal(project.status, 'COMPLETED');
  const output = path.join(dataDir, 'final.mp4');
  await download(`${route}/files/${project.finalFile}`, output);
  const metadata = await inspect(output);
  assert.deepEqual([metadata.width, metadata.height], [1080, 1920]);
  assert.equal(metadata.codec, 'h264');
  assert.ok(metadata.duration > 0 && metadata.duration <= 120.1);
  const { stdout } = await run(ffprobe.path, ['-v', 'error', '-show_streams', '-of', 'json', output]);
  assert.equal(JSON.parse(stdout).streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'aac');
  await ff(['-v', 'error', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  await ff(['-ss', '1', '-i', output, '-frames:v', '1', path.join(dataDir, 'final-frame.jpg')]);
  await writeFile(path.join(dataDir, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), projectId: project.id, model: project.analysisModel, candidateCount: project.candidates.length, selectedCandidate: candidate, settings: project.settings, metadata, jobs: jobResults, output }, null, 2));
  console.log(`PASS: real Gemini analysis/edit, H264/AAC 1080x1920, ${metadata.duration}s; ${output}`);
} catch (error) {
  console.error(`FAIL: ${safe(error)}`);
  console.error(`Artifacts retained: ${dataDir}`);
  process.exitCode = 1;
} finally {
  await worker?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
