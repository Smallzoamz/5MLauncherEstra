const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const env = { ...process.env, LAUNCHER_TEST_USER_DATA: path.resolve('tests/artifacts/tray-profile') }; delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ executablePath: require('electron'), args: ['tests/tray-harness.cjs'], env, cwd: process.cwd() });
  try {
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForURL('launcher://app/'); await page.locator('#selected-server').waitFor();
    assert.equal(await app.evaluate(() => global.estraTest.trays.length), 1);
    const waitVisible = async value => {
      const until = Date.now() + 10000;
      while (Date.now() < until) { if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()) === value) return; await new Promise(r => setTimeout(r, 30)); }
      throw Error('Visibility did not become ' + value);
    };
    const launch = async cl2 => {
      const fivemPath = await app.evaluate(() => global.estraTest.fixture);
      return page.evaluate(async ({ fivemPath, cl2 }) => {
        const { token } = await (await fetch('/api/session')).json();
        const response = await fetch('/api/launch-fivem', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token }, body: JSON.stringify({ ip: 'example.com:30120', cl2, fivemPath }) });
        return { status: response.status, body: await response.json() };
      }, { fivemPath, cl2 });
    };
    const restoreFromTray = () => app.evaluate(() => global.estraTest.trays[0].emit('click'));
    // Native close keeps both the app and its actual Tray alive.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await waitVisible(false);
    assert.equal(await app.evaluate(() => global.estraTest.trays[0].isDestroyed()), false);
    await restoreFromTray(); await waitVisible(true);
    await page.getByLabel('เมนูหน้าต่าง Estra', { exact: true }).click();
    await page.getByRole('button', { name: 'ซ่อนลง System Tray', exact: true }).click(); await waitVisible(false);
    await restoreFromTray(); await waitVisible(true);
    await app.evaluate(() => { global.estraTest.failDispatch = true; });
    assert.equal((await launch(false)).status, 503); await waitVisible(true);
    await app.evaluate(() => { global.estraTest.failDispatch = false; });
    assert.equal((await launch(false)).status, 200); await waitVisible(false);
    await app.evaluate(() => { global.estraTest.pids = [123]; });
    const runningDeadline = Date.now() + 5000;
    while (Date.now() < runningDeadline && !(await app.evaluate(() => global.estraTest.tooltip)).includes('กำลังทำงาน')) await new Promise(r => setTimeout(r, 30));
    assert.ok((await app.evaluate(() => global.estraTest.tooltip)).includes('กำลังทำงาน'));
    await app.evaluate(() => { global.estraTest.pids = []; }); await waitVisible(true);
    await page.getByRole('status').filter({ hasText: 'FiveM ปิดแล้ว' }).waitFor();
    // No new process: returns from Tray after startup deadline.
    assert.equal((await launch(false)).status, 200); await waitVisible(false); await waitVisible(true);
    await page.getByRole('status').filter({ hasText: 'ไม่พบ FiveM หลังส่งคำสั่งเปิด' }).waitFor();
    // CL2 session is tracked independently from the pre-existing game PID.
    await app.evaluate(() => { global.estraTest.pids = [111]; });
    assert.equal((await launch(false)).status, 409); await waitVisible(true);
    assert.equal((await launch(true)).status, 200); await waitVisible(false);
    await app.evaluate(() => { global.estraTest.pids = [111, 222]; });
    const until = Date.now() + 5000;
    while (Date.now() < until && !(await app.evaluate(() => global.estraTest.tooltip)).includes('กำลังทำงาน')) await new Promise(r => setTimeout(r, 30));
    assert.ok((await app.evaluate(() => global.estraTest.tooltip)).includes('กำลังทำงาน'));
    await app.evaluate(() => { global.estraTest.pids = [111]; }); await waitVisible(true);
    await page.screenshot({ path: 'tests/artifacts/tray-restored.png' });
    assert.deepEqual(errors, []);
    const evidence = { actualTrayCreated: true, nativeCloseHides: true, trayClickRestores: true, menuHides: true, failedDispatchStaysVisible: true, launchHides: true, gameExitRestores: true, timeoutRestores: true, cl2TracksNewPid: true, realGameLaunched: false, pageErrors: errors };
    await page.getByLabel('เมนูหน้าต่าง Estra', { exact: true }).click();
    const close = app.waitForEvent('close');
    await page.getByRole('button', { name: 'ปิดโปรแกรม', exact: true }).click().catch(e => { if (!/closed/.test(e.message)) throw e; }); await close; app = null;
    evidence.explicitQuitExits = true;
    await fs.writeFile('tests/artifacts/tray-smoke.json', JSON.stringify(evidence, null, 2)); console.log(evidence);
  } finally { await app?.close(); }
})().catch(e => { console.error(e); process.exit(1); });
