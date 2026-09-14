import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import * as renderer from '../server/ai/render.mjs';

test('ad defaults preserve the opening and validate clip-relative placement', () => {
  const ad = renderer.normalizeAd({}, 60);
  assert.equal(ad.start, 27.5);
  assert.equal(ad.duration, 5);
  assert.equal(ad.position, 'auto');
  assert.equal(renderer.normalizeAd({ position: 'bottom-right' }, 60).position, 'bottom-right');
  for (const value of [{ start: -1 }, { start: 59, duration: 5 }, { position: 'unsafe' }, { width: 99 }, { opacity: NaN }]) assert.throws(() => renderer.normalizeAd(value, 60));
});

test('video advertisement keeps motion, placement and timing in preview and export', async t => {
  await mkdir(path.resolve('tmp'), { recursive: true });
  const dir = await mkdtemp(path.resolve('tmp/ad-render-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'source.mp4'), adFile = path.join(dir, 'advertisement.mp4');
  await renderer.ff(['-f', 'lavfi', '-i', 'color=blue:size=320x180:rate=10:duration=4', '-c:v', 'libx264', input]);
  await renderer.ff(['-f', 'lavfi', '-i', 'color=red:size=100x50:rate=10:duration=0.5', '-f', 'lavfi', '-i', 'color=lime:size=100x50:rate=10:duration=0.5', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', adFile]);
  for (const [format, preview] of [['9:16', true], ['16:9', true], ['1:1', true], ['1:1', false]]) {
    const output = path.join(dir, `result-${format.replace(':', '-')}-${preview}.mp4`);
    await renderer.render({ input, output, preview, settings: renderer.normalizeSettings({ start: 0, end: 4, format, subtitles: false, cropMode: 'manual' }, 4), ad: { file: adFile, kind: 'video', position: 'bottom-right', width: 30, start: 1, duration: 2, opacity: 1 } });
    const metadata = await renderer.inspect(output);
    assert.ok(Math.abs(metadata.duration - 4) < .15, `duration ${metadata.duration}`);
    assert.equal(metadata.hasAudio, false, 'ad does not introduce music or sound');
    const y = Math.round(metadata.height * .78 - Math.min(metadata.width * .15, metadata.height * .25) / 2);
    for (const [time, expected] of [[.4, 'blue'], [1.1, 'red'], [1.7, 'green'], [3.5, 'blue']]) {
      const sample = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', output, '-vf', `crop=2:2:${Math.round(metadata.width * .85)}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
      assert.equal(sample.status, 0);
      const colors = [...sample.stdout.subarray(0, 3)], channel = { red: 0, green: 1, blue: 2 }[expected];
      assert.ok(colors[channel] > Math.max(...colors.filter((_, i) => i !== channel)) + 100, `${format} preview=${preview} t=${time}: ${colors}, expected ${expected}`);
    }
  }
});

test('sparse or missing face detections preserve both source edges in smart mode', async t => {
  await mkdir(path.resolve('tmp'), { recursive: true });
  const dir=await mkdtemp(path.resolve('tmp/sparse-face-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'source.mp4');
  await renderer.ff(['-f','lavfi','-i','color=red:size=320x180:rate=10:duration=2,drawbox=x=0:y=0:w=30:h=ih:color=lime:t=fill,drawbox=x=iw-30:y=0:w=30:h=ih:color=lime:t=fill','-c:v','libx264',input]);
  const face={x:.4,y:.2,width:.2,height:.4};
  for(const tracking of [[{time:0,x:.5,faces:[face]}], [0,.5,1,1.5].map(time=>({time,x:.5,faces:time===1?[]:[face]}))]) {
    const output=path.join(dir,`result-${tracking.length}.mp4`);
    await renderer.render({input,output,preview:true,settings:renderer.normalizeSettings({start:0,end:2,subtitles:false},2),analysis:{width:320,height:180,tracking}});
    for(const x of [20,520]) {
      const sample=spawnSync(ffmpeg,['-v','error','-ss','1','-i',output,'-vf',`crop=2:2:${x}:480`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
      assert.equal(sample.status,0);
      const [red,green]=sample.stdout; assert.ok(green>red+100,`edge ${x} must survive unreliable tracking: ${red},${green}`);
    }
  }
});
