import assert from 'node:assert/strict';
import test from 'node:test';
import { studioProgress } from '../src/ai-progress.ts';

test('progress labels stage estimates and never invents elapsed-time progress or completion',()=>{
  assert.equal(studioProgress('ANALYZING',42).value,68);
  assert.equal(studioProgress('ANALYZING',null).value,60);
  assert.equal(studioProgress('ANALYZING',null).estimated,true);
  assert.equal(studioProgress('ANALYZING',100).value,80);
  assert.equal(studioProgress('ANALYZING',100,null,true).value,99);
  assert.equal(studioProgress('ANALYZING',null,null,true).value,80);
  assert.equal(studioProgress('RENDERING',42).value,42);
  assert.equal(studioProgress('FAILED',100).value,null);
  assert.equal(studioProgress('UPLOADING',null,25).value,25);
  assert.equal(studioProgress('COMPLETED',null).value,100);
  assert.equal(studioProgress('RENDERING',NaN).value,null);
  assert.equal(studioProgress('READY',null).label,'Видео подготовлено');
});
