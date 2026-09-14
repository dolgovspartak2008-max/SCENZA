import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from '../server/ai/worker.mjs';
import { createStore } from '../server/ai/store.mjs';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server/index.mjs';

test('worker retries a temporary database timeout without restarting and rejects denied access',async()=>{
  const root=path.resolve('.scena/worker-recovery-tests');await mkdir(root,{recursive:true});
  const dataDir=await mkdtemp(path.join(root,'recovery-'));
  let worker;
  try {
    worker=await createWorker({dataDir,env:{}});
    let calls=0;
    worker.once=async()=>{calls++;if(calls===1)throw Object.assign(new Error('Temporary test failure'),{status:504});worker.stop();return true;};
    await worker.start();assert.equal(calls,2);
    worker=await createWorker({dataDir,env:{}});
    worker.once=async()=>{throw Object.assign(new Error('Access denied'),{status:403});};
    await assert.rejects(()=>worker.start(),/Access denied/);
  }finally{
    await worker?.close();assert.ok(path.resolve(dataDir).startsWith(root+path.sep));await rm(dataDir,{recursive:true,force:true});
  }
});

test('failed text edit keeps the rendered version available for approval and another edit',async()=>{
  const root=path.resolve('.scena/worker-recovery-tests');await mkdir(root,{recursive:true});
  const dataDir=await mkdtemp(path.join(root,'edit-'));
  let worker,store,server;
  try {
    store=await createStore({dataDir:path.join(dataDir,'ai'),env:{}});
    const settings={start:0,end:10},id=randomUUID();
    await store.saveProject('local',{id,status:'AWAITING_APPROVAL',duration:20,files:{},analysis:{segments:[]},candidates:[],versions:[{id:'version-1',settings}],currentVersion:'version-1',settings});
    const job=await store.enqueue('local',id,'revise',{request:'Неподдерживаемая правка',settings});
    worker=await createWorker({dataDir,env:{},provider:{interpretEditRequest:async()=>{throw Object.assign(new Error('Лимит Gemini API исчерпан.'),{code:'AI_RATE_LIMITED',status:429});}}});
    await worker.once();
    const project=await store.getProject('local',id),result=await store.getJob('local',job.id);
    assert.equal(result.status,'error');
    assert.equal(project.status,'AWAITING_APPROVAL');
    assert.equal(project.currentVersion,'version-1');
    assert.deepEqual(project.settings,settings);
    assert.match(project.error,/Предыдущая версия/);
    assert.equal(project.versions.length,1);
    server=await createServer({dataDir,seed:false,authOptions:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    for(const action of ['approve','restore']) {
      await store.saveProject('local',project);
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/video/projects/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionId:'version-1'})});
      assert.equal(response.status,200);
      assert.equal((await response.json()).project.error,null,`${action} clears obsolete edit warning`);
    }
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await worker?.close();await store?.close();assert.ok(dataDir.startsWith(root+path.sep));await rm(dataDir,{recursive:true,force:true});}
});
