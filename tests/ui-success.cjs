const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless:true, args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions:['microphone'], viewport:{ width:1366,height:900 } });
  const page = await context.newPage(), errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.testStreams = [];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await get(...args); window.testStreams.push(stream); return stream; };
  });
  await page.route('**/api/server-query?*', r => r.fulfill({ json:{ online:true,status:'Online',clients:1,maxClients:32,gameBuild:'3095',lockPure:0 } }));
  await page.route('**/api/installation?*', r => r.fulfill({json:{success:true,exe:'C:/Fixture/FiveM.exe'}}));
  await page.route('**/api/system-presence', r => r.fulfill({json:{fivem:{running:false},steam:{running:true},discord:{running:true}}}));
  await page.route('**/api/clean-cache', r => { calls.push('cache'); assert.equal(r.request().postDataJSON().fivemPath,'C:/Fixture'); return r.fulfill({json:{success:true,steps:['fixture cleaned']}}); });
  await page.route('**/api/launch-fivem', r => { calls.push('launch'); assert.equal(r.request().postDataJSON().fivemPath,'C:/Fixture'); assert.equal(r.request().postDataJSON().cl2,true); return r.fulfill({json:{success:true,message:'fixture launch accepted'}}); });
  await page.goto(process.env.LAUNCHER_URL || 'http://127.0.0.1:5199');
  await page.getByText('1 / 32', {exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.testStreams.length),0);
  await page.getByRole('button',{name:'เช็คไมค์',exact:true}).click();
  await page.waitForFunction(() => window.testStreams.some(s => s.getTracks().some(t => t.readyState === 'live')));
  const loop = page.getByRole('button',{name:'เปิดฟังเสียงตัวเอง',exact:true}); await loop.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'เปิดฟังเสียงตัวเอง' && !b.disabled));
  await loop.click();
  await page.getByRole('button',{name:'กำลังฟังเสียงตัวเอง (เปิดอยู่)',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  await page.getByRole('button',{name:'เช็คไมค์',exact:true}).click();
  await page.getByRole('button',{name:'เปิดฟังเสียงตัวเอง',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'การตั้งค่า',exact:true}).click();
  await page.getByLabel('ตำแหน่ง FiveM.exe หรือโฟลเดอร์ติดตั้ง').fill('C:/Fixture');
  await page.getByLabel('ล้างแคชก่อนเปิดเกม').check();
  await page.getByLabel('กำหนดให้เปิด Steam และ Discord ก่อนเล่น').check();
  await page.getByRole('button',{name:'บันทึกการตั้งค่า'}).click();
  await page.getByRole('switch').click();
  await page.getByRole('button',{name:'กดเล่น',exact:true}).click();
  await page.getByText('fixture launch accepted',{exact:true}).waitFor();
  assert.deepEqual(calls,['cache','launch']);
  assert.equal(await page.evaluate(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))),true);
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS: synthetic microphone capture, loopback reset, track release, preflight microphone, custom path, CL2, cache-before-launch, one successful launch. No real game/cache action.');
})().catch(e => {console.error(e);process.exit(1)});


