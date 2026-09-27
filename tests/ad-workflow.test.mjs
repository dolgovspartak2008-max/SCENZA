import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createVideoApi } from '../server/ai/api.mjs';
import { createWorker } from '../server/ai/worker.mjs';
import { ff, inspect, normalizeSettings } from '../server/ai/render.mjs';
import { PRIMARY_VIDEO_MODEL, ANALYSIS_VERSION } from '../server/ai/openai.mjs';

test('uploaded video ad survives decoding, AI edits, approval, preview and export', async t => {
  await mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/ad-workflow-')), id = randomUUID();
  const env = {};
  const api = await createVideoApi({ dataDir, env });
  const server = createServer(async (request, response) => {
    try { await api.handle(request, response, 'ad-test'); }
    catch (error) { response.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); }
  });
  const worker = await createWorker({ dataDir, env: {}, provider: { interpretEditRequest: async ({ ad }) => {
    assert.equal(ad.kind, 'video'); return { ad: { position: 'bottom-right', start: 1, duration: 2 } };
  } } });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await worker.close(); await api.close(); assert.ok(dataDir.startsWith(path.resolve('tmp') + path.sep)); await rm(dataDir, { recursive: true, force: true }); });
  const objects = path.join(dataDir, 'ai/objects', id); await mkdir(objects, { recursive: true });
  const original = path.join(objects, 'original.mp4'), advertisement = path.join(dataDir, 'ad.mp4');
  await ff(['-f','lavfi','-i','color=blue:s=160x90:r=10:d=4','-c:v','libx264',original]);
  await ff(['-f','lavfi','-i','testsrc2=s=100x50:r=10:d=1','-c:v','libx264',advertisement]);
  const settings = normalizeSettings({ start: 0, end: 4, subtitles: false, format: '1:1' }, 4);
  await api.store.saveProject('ad-test', { id, title:'Ad test', status:'APPROVED', duration:4, settings, currentVersion:'initial', approvedVersion:'initial', candidates:[{ id:randomUUID(), start:0, end:4, ready:true, settings }], versions:[{id:'initial',number:1,settings,ad:null}], files:{original:{key:`${id}/original.mp4`,mime:'video/mp4'}}, analysis:{hasAudio:false,segments:[],tracking:[]}, music:[] });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`, route=`/api/video/projects/${id}`;
  const request = async (endpoint, method='GET', body) => {
    const response=await fetch(base+endpoint,{method,...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});
    const result=await response.json(); assert.ok(response.ok,JSON.stringify(result)); return result;
  };
  const complete = async job => { await worker.once(); const result=await api.store.getJob('ad-test',job.id); assert.equal(result.status,'done',JSON.stringify(result)); };
  await complete((await request(`${route}/advertisement?filename=ad.mp4`,'POST',await readFile(advertisement))).job);
  let project=(await request(route)).project;
  assert.equal(project.ad.kind,'video'); assert.equal(project.files[project.ad.fileId].mime,'video/mp4');
  await complete((await request(`${route}/revise`,'POST',{request:'Поставь рекламу справа снизу'})).job);
  project=(await request(route)).project;
  assert.equal(project.ad.position,'bottom-right'); assert.equal(project.ad.start,1); assert.equal(project.status,'AWAITING_APPROVAL');
  for (const key of ['analysis','analysisResult','analysisCache','editCache','sourceFingerprint']) assert.equal(project[key],undefined,`${key} stays server-side`);
  const editedVersion=project.currentVersion;
  await request(`${route}/approve`,'POST');
  await complete((await request(`${route}/ad-preview`,'POST')).job);
  await complete((await request(`${route}/export`,'POST')).job);
  project=(await request(route)).project;
  const output=await inspect(path.join(dataDir,'ai/objects',project.files[project.finalFile].key));
  assert.deepEqual([output.width,output.height],[1080,1080]); assert.equal(output.hasAudio,false);
  assert.ok(Math.abs(output.duration-4)<.2);
  const usage=await request('/api/video/usage');
  assert.equal(usage.sourceMinutes,0); assert.equal(usage.editRequests,1); assert.equal(usage.cost,undefined); assert.equal(usage.models,undefined);
  assert.equal((await request(`${route}/restore`,'POST',{versionId:'initial'})).project.ad,null);
  assert.equal((await request(`${route}/restore`,'POST',{versionId:editedVersion})).project.ad.position,'bottom-right');
  project=await api.store.getProject('ad-test',id);
  project.status='READY';
  // Banners added during review are previewed live, so found moments are not re-rendered; give the candidate its file.
  project.files[project.candidates[0].id]=project.files.original;
  project.analysisCache={version:ANALYSIS_VERSION,model:PRIMARY_VIDEO_MODEL,source:createHash('sha256').update(JSON.stringify([project.sourceFingerprint,project.files.original?.key,project.upload?.size,project.duration])).digest('hex')};
  await api.store.saveProject('ad-test',project);
  assert.equal((await request(`${route}/analyze`,'POST')).cached,true);
  env.PRIMARY_VIDEO_MODEL='test/updated-video-model';
  assert.ok((await request(`${route}/analyze`,'POST')).job,'changing the analysis model must enqueue fresh analysis');
});
