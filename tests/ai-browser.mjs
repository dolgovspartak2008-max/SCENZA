import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
page.on('pageerror',error=>errors.push(error.message));
const base=process.env.APP_URL||'http://127.0.0.1:5173';
await mkdir('tmp/ui-checks',{recursive:true});
try {
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    await page.goto(`${base}/app/settings`);await page.getByRole('heading',{name:'Настройки',exact:true}).waitFor();
    assert.equal(await page.getByText('Токен бота',{exact:true}).count(),0);
    assert.equal(await page.locator('.scenza-session-strip').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/ui-checks/ai-settings-${width}.png`,fullPage:true});
    await page.goto(`${base}/app/upload`);await page.getByRole('heading',{name:'Создайте свой ролик'}).waitFor();
    await page.locator('.studio-import summary').click();
    await page.getByRole('textbox',{name:'Или прямая ссылка на видео'}).fill('https://example.com/video.mp4');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/ui-checks/ai-upload-${width}.png`,fullPage:true});
  }
  let chunk=0;
  await page.route('**/api/video/projects/*/upload',async route=>{chunk++;if(chunk===2)await route.abort('failed');else await route.continue();});
  const source=await readFile(path.resolve('public/videos/platform-example-5958.mp4'));
  const upload={name:'resume-check.mp4',mimeType:'video/mp4',buffer:Buffer.concat([source,Buffer.alloc(9*1024*1024)])};
  await page.locator('input[type=file]').first().setInputFiles(upload);
  await page.getByRole('alert').waitFor();
  assert.equal(chunk,2,'second chunk was interrupted after a saved first chunk');
  await page.locator('input[type=file]').first().setInputFiles(upload);
  await page.waitForURL(/\/app\/ai\/[\w-]+/,{timeout:60000});
  await page.getByText('AI-анализ пока не подключён.',{exact:false}).waitFor({timeout:60000});
  await page.waitForFunction(()=>document.querySelector('.ai-status')?.textContent.includes('Готово к монтажу'),{timeout:60000});
  assert.equal(await page.getByRole('button',{name:'Найти лучшие моменты'}).isDisabled(),true);
  await page.reload();await page.getByText('Готово к монтажу',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'tmp/ui-checks/ai-project-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile settings, interrupted chunk upload/resume, project reload, honest missing-key state, no overflow/page errors');
}finally{await browser.close();}
