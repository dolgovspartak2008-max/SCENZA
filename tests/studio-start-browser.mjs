import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const calls = [], errors = [];
let projectStatus = 'ANALYZING', jobProgress = 42;
const videoProject = () => ({ id:'progress-check', title:'Проверка анализа', status:projectStatus, duration:102, upload:{name:'video.mp4',size:5*1024**2,bytes:5*1024**2}, candidates:[], versions:[], files:{}, music:[], jobId:'job-check' });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/api/**', async route => {
  const request = route.request(), pathname = new URL(request.url()).pathname;
  calls.push({ pathname, method: request.method() });
  const body = pathname === '/api/auth/session' ? { user: { id: 'browser-user', accessActive: true }, localStudioAllowed: false }
    : pathname === '/api/video/config' ? { aiReady: true, maxFileSize: 20 * 1024 ** 3, chunkSize: 8 * 1024 ** 2 }
    : pathname === '/api/video/projects/progress-check' ? { project:videoProject() }
    : pathname === '/api/video/jobs/job-check' ? { job:{id:'job-check',status:projectStatus==='FAILED'?'error':'running',stage:'Поиск интересных моментов',progress:jobProgress,error:projectStatus==='FAILED'?'Ответ AI оборвался. Повторите обработку.':undefined} }
    : { projects: [] };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
try {
  await mkdir('tmp/ui-checks', { recursive: true });
  for (const width of [1672, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/app`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Загрузить видео', exact: true }).count(), 1);
    await page.locator('.studio-art').evaluate(image => image.decode());
    assert.equal(await page.getByRole('heading', { name:'Идеи для вашего видео' }).count(), width > 760 ? 1 : 0);
    assert.equal(await page.locator('.studio-tools').isVisible(), width > 760);
    assert.equal(await page.locator('.studio-quick button, .studio-quick a, .studio-quick [tabindex]').count(), 0);
    assert.equal(await page.locator('.studio-tools').getByText('AI-монтаж',{exact:true}).count(), 1);
    assert.equal(await page.locator('.sidebar a[title="Тренды"]').count(), 0);
    assert.equal(await page.locator('.sidebar a[href="/app/ai"]').count(), 1);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(calls.filter(call => call.pathname === '/api/projects').length, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `tmp/ui-checks/studio-start-${width}.png`, fullPage: true });
    const fileChooser=page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Загрузить видео', exact: true }).click();
    await fileChooser;
    await page.goto(`${base}/app/upload`);
    await page.getByRole('heading', { name: 'Создайте свой ролик', exact: true }).waitFor();
    await page.locator('.studio-import summary').click();
    await page.getByRole('textbox', { name:'Или прямая ссылка на видео' }).fill('https://example.com/video.mp4');
    assert.equal(calls.filter(call => call.pathname === '/api/projects').length, 0);
    await page.goto(`${base}/app/ai`);
    await page.getByRole('button', { name: 'Новый проект', exact: true }).waitFor();
    assert.equal(calls.filter(call => call.pathname === '/api/projects').length, 0);
  }
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    projectStatus='ANALYZING';jobProgress=42;
    await page.goto(`${base}/app/ai/progress-check`);
    await page.getByText('Осталось примерно 32% · время зависит от видео',{exact:true}).waitFor();
    assert.equal(await page.getByRole('progressbar').getAttribute('value'),'68');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/ui-checks/studio-progress-${width}.png`,fullPage:true});
    jobProgress=null;
    await page.reload();
    await page.getByText('Осталось примерно 40% · время зависит от видео',{exact:true}).waitFor();
    assert.equal(await page.getByRole('progressbar').getAttribute('value'),'60');
    projectStatus='RENDERING';
    await page.reload();
    await page.getByText('Сервис не сообщает точный процент этого этапа.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('progressbar').getAttribute('value'),null);
    projectStatus='FAILED';
    await page.reload();
    await page.getByRole('button',{name:'Повторить обработку',exact:true}).waitFor();
    assert.equal(await page.getByRole('progressbar').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/ui-checks/studio-error-${width}.png`,fullPage:true});
  }
  await page.goto(`${base}/app/library`);
  await page.waitForURL(`${base}/app/ai`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(calls.filter(call => call.pathname === '/api/projects').length, 0);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.deepEqual(errors, []);
  console.log('PASS: 1672/1440/768/390 studio, working file picker and URL input; measured/unknown/error progress at 1440/390; no overflow or browser errors. API fixtures only.');
} finally { await browser.close(); }
