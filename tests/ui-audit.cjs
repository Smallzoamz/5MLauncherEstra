const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.LAUNCHER_URL || 'http://127.0.0.1:5199';
(async () => {
  await fs.mkdir('tests/artifacts', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  // Deterministic transport fixtures. Never launch a real process or delete real cache.
  let launches = 0, cleanCalls = 0, offline = false;
  await page.route('**/api/server-query?*', route => route.fulfill({ json: offline ?
    { online: false, status: 'Unreachable', clients: null, maxClients: null, error: 'fixture unavailable' } :
    { online: true, status: 'Online', clients: 0, maxClients: 32, gameBuild: '3095', lockPure: 0, ping: 0 } }));
  await page.route('**/api/system-presence', route => route.fulfill({ json: { fivem: { running: false }, steam: { running: false }, discord: { running: true } } }));
  await page.route('**/api/installation?*', route => route.fulfill({ json: { success: true, exe: 'C:/Fixture/FiveM.exe' } }));
  await page.route('**/api/launch-fivem', route => { launches++; return route.fulfill({ status: 400, json: { success: false, error: 'fixture launch denied' } }); });
  await page.route('**/api/clean-cache', route => { cleanCalls++; return route.fulfill({ status: 409, json: { success: false, error: 'fixture cache denied' } }); });
  await page.goto(base);
  await page.getByText('0 / 32', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'tests/artifacts/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '+ NEW', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('ชื่อเซิร์ฟเวอร์', { exact: true }).fill('QA Training');
  await page.getByLabel('IP:port / โดเมน / Cfx.re join link').fill('bad&calc');
  await page.getByRole('button', { name: 'เพิ่มเซิร์ฟเวอร์', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  await page.getByLabel('IP:port / โดเมน / Cfx.re join link').fill('cfx.re/join/abcdef');
  await page.getByLabel('หมวดหมู่', { exact: true }).selectOption('Training');
  await page.getByRole('button', { name: 'เพิ่มเซิร์ฟเวอร์', exact: true }).click();
  await page.getByRole('button', {name:'รายละเอียดเมือง',exact:true}).click();
  assert.equal(await page.locator('#server-ip').inputValue(), 'cfx.re/join/abcdef');
  await page.locator('#server-name').fill('Renamed QA');
  await page.reload(); await page.getByText('0 / 32', { exact: true }).waitFor();
  await page.getByRole('button', {name:'รายละเอียดเมือง',exact:true}).click();
  assert.equal(await page.locator('#server-name').inputValue(), 'Renamed QA');
  await page.getByRole('button', { name: 'EDIT', exact: true }).click();
  await page.locator('#server-ip').fill('example.com:30120');
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  assert.equal(await page.locator('#server-ip').inputValue(), 'example.com:30120');
  await page.getByRole('button', { name: 'การตั้งค่า', exact: true }).click();
  await page.getByLabel('ตำแหน่ง FiveM.exe หรือโฟลเดอร์ติดตั้ง').fill('C:/Unsaved');
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'การตั้งค่า', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#fivem-path')?.value === '');
  assert.equal(await page.getByLabel('ตำแหน่ง FiveM.exe หรือโฟลเดอร์ติดตั้ง').inputValue(), '');
  await page.getByLabel('ตรวจสิทธิ์และเปิดไมโครโฟนก่อนเล่น').uncheck();
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).click();
  await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'fixture launch denied' }).waitFor();
  assert.equal(launches, 1);
  await page.getByRole('button', { name: 'ล้างแคช', exact: true }).click();
  await page.getByRole('button', { name: 'ยืนยันล้างแคช', exact: true }).click();
  await page.getByText('fixture cache denied', { exact: true }).waitFor();
  assert.equal(cleanCalls, 1);
  assert.equal(await page.getByText('ล้างแคชเสร็จแล้ว', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'ปิด', exact: true }).click();
  offline = true;
  await page.getByRole('button', { name: 'รีเฟรช', exact: true }).click();
  await page.getByText('fixture unavailable', { exact: true }).waitFor();
  assert.equal(await page.getByText('Online', { exact: true }).count(), 0);
  assert.equal(await page.getByText('— / —', { exact: true }).count(), 1);
  // Microphone denial is surfaced. Permission is requested only on explicit test.
  await page.getByRole('button', {name:'เช็คไมค์',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  // Small windows and narrow mobile.
  for (const width of [900, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'overflow at ' + width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'tests/artifacts/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'การตั้งค่า', exact: true }).click();
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'ปิด');
  assert.equal(await page.getByRole('dialog').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, 'mobile modal must fit viewport');
  await page.screenshot({ path: 'tests/artifacts/mobile-settings.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'ดูรายการเมืองทั้งหมด'}).click();
  page.on('dialog', dialog => dialog.accept());
  while (await page.locator('.server-card-remove').count()) await page.locator('.server-card-remove').first().click();
  await page.keyboard.press('Escape');
  await page.getByText('ยังไม่มีเซิร์ฟเวอร์ที่บันทึก', { exact: true }).waitFor();
  await page.reload(); await page.getByText('ยังไม่มีเซิร์ฟเวอร์ที่บันทึก', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(JSON.stringify({ passed: true, desktop: '1366x900', widths: [900,390,320], pageErrors: errors, launchCalls: launches, cacheCalls: cleanCalls, checks: ['CRUD persistence', 'invalid input', 'settings cancel/save', 'single launch error', 'cache error', 'no fake online', 'mic denial', 'modal keyboard', 'responsive overflow', 'empty persistence'] }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });


