const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const profile = await fs.mkdtemp(path.resolve('tests/artifacts/history-tray-profile-'));
  const env = { ...process.env, LAUNCHER_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: ['tests/tray-harness.cjs'], env, cwd: process.cwd() });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForURL('launcher://app/'); await page.locator('#selected-server').waitFor();
    const fixture = await app.evaluate(() => global.estraTest.fixture);
    await page.evaluate(fivemPath => {
      localStorage.setItem('fivem_launcher_settings_v3', JSON.stringify({ fivemPath, checkMicBeforeLaunch: false, autoClearCacheBeforeLaunch: true }));
      localStorage.setItem('fivem_launcher_servers_v3', JSON.stringify([{ id: 'test', name: 'Estra Tray City', ip: 'example.com:30120', cl2: false }]));
    }, fixture);
    // No cache directories are present in the fixture, so keep auto cleanup off for dispatch checks.
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('fivem_launcher_settings_v3')); s.autoClearCacheBeforeLaunch = false; localStorage.setItem('fivem_launcher_settings_v3', JSON.stringify(s)); });
    await page.reload(); await page.locator('#selected-server').waitFor();
    const menu = () => app.evaluate(() => { const m = global.estraTest.menu.getMenuItemById('launch-latest'); return { enabled: m.enabled, label: m.label }; });
    const wait = async condition => { const until = Date.now() + 10000; while (Date.now() < until) { if (await condition()) return; await new Promise(r => setTimeout(r,50)); } throw Error('Condition timed out'); };
    const history = () => page.evaluate(() => JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1') || '[]'));
    assert.equal((await menu()).enabled, false);
    await app.evaluate(() => { global.estraTest.failDispatch = true; });
    await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await wait(async () => (await history())[0]?.status === 'failed'); assert.equal((await menu()).enabled, false);
    await app.evaluate(() => { global.estraTest.failDispatch = false; });
    await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await wait(async () => (await menu()).enabled);
    assert.ok((await menu()).label.includes('Estra Tray City'));
    await wait(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
    // Two native clicks while the UI is responding must issue only one dispatch.
    const before = await app.evaluate(() => global.estraTest.dispatches);
    await app.evaluate(() => { const item = global.estraTest.menu.getMenuItemById('launch-latest'); item.click(); item.click(); });
    await wait(async () => (await history()).length === 3 && (await history())[0].status === 'sent');
    assert.equal(await app.evaluate(() => global.estraTest.dispatches), before + 1);
    await wait(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
    await page.reload(); await page.locator('#selected-server').waitFor(); await wait(async () => (await menu()).enabled);
    assert.equal((await history()).length, 3);
    const label = (await menu()).label;
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      ipcMain.emit('estra:latest-city', { sender: w.webContents, senderFrame: { url: 'https://evil.example' } }, { name: 'Injected City', enabled: true });
      ipcMain.emit('estra:latest-city', { sender: w.webContents, senderFrame: w.webContents.mainFrame }, { name: 'bad\nname', enabled: true });
    });
    assert.equal((await menu()).label, label);
    // A running game still blocks a Tray launch and the attempt records the reason.
    await app.evaluate(() => { global.estraTest.pids = [12345]; });
    const count = await app.evaluate(() => global.estraTest.dispatches);
    await app.evaluate(() => global.estraTest.menu.getMenuItemById('launch-latest').click());
    await wait(async () => (await history()).length === 4 && (await history())[0].status === 'failed');
    assert.equal(await app.evaluate(() => global.estraTest.dispatches), count);
    assert.match((await history())[0].error, /FiveM กำลังทำงาน/);
    await page.getByRole('switch', { name: 'เปิด FiveM ตัวที่สอง (Legacy)' }).click();
    await wait(async () => (await menu()).enabled);
    await app.evaluate(() => global.estraTest.menu.getMenuItemById('launch-latest').click());
    await wait(async () => (await history()).length === 5 && (await history())[0].status === 'sent');
    assert.equal((await history())[0].city.cl2, true);
    await wait(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
    await page.getByRole('button', { name: 'ประวัติการเปิดเกม', exact: true }).click();
    await wait(async () => !(await menu()).enabled);
    await page.screenshot({ path: 'tests/artifacts/history-tray-1.7.0.png', animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => localStorage.setItem('fivem_launcher_servers_v3', '[]')); await page.reload();
    await page.getByText('ยังไม่มีเซิร์ฟเวอร์ที่บันทึก', { exact: true }).waitFor(); await wait(async () => !(await menu()).enabled);
    assert.deepEqual(errors, []);
    const evidence = { actualTrayShortcut: true, latestSuccessfulDispatchOnly: true, duplicateClicksDispatchOnce: true, rendererReloadPersists: true, runningGameBlocked: true, currentCl2Used: true, modalDisablesTrayLaunch: true, deletedCityDisablesShortcut: true, untrustedAndMalformedIpcRejected: true, realGameLaunched: false, pageErrors: errors };
    await fs.writeFile('tests/artifacts/history-tray-1.7.0.json', JSON.stringify(evidence,null,2)); console.log(evidence);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });
