const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.resolve('tests/artifacts/history-packaged-profile-'));
  const env = { ...process.env, LAUNCHER_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: process.env.LAUNCHER_PACKAGED_EXE, args: [], env });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('launcher://app/'); await page.locator('#selected-server').waitFor();
    await app.evaluate(({ Tray }) => {
      const original = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) { global.historyTestMenu = menu; return original.call(this, menu); };
    });
    const invalidInstallation = path.join(profile, 'missing-fivem-installation');
    assert.equal(await fs.stat(invalidInstallation).catch(() => null), null);
    await page.evaluate(fivemPath => {
      const city = { id: 'packaged-history', name: 'Estra History Test', ip: 'example.com:30120', cl2: false };
      localStorage.setItem('fivem_launcher_servers_v3', JSON.stringify([city]));
      localStorage.setItem('fivem_launcher_settings_v3', JSON.stringify({ fivemPath, checkMicBeforeLaunch: false }));
      localStorage.setItem('fivem_launcher_launch_history_v1', JSON.stringify([{ id: 'seeded-history', city, status: 'sent', startedAt: new Date().toISOString(), error: '' }]));
    }, invalidInstallation);
    await page.reload(); await page.locator('#selected-server').waitFor();
    const wait = async condition => { const end = Date.now() + 10000; while (Date.now() < end) { if (await condition()) return; await new Promise(r => setTimeout(r,50)); } throw Error('Condition timed out'); };
    await wait(() => app.evaluate(() => global.historyTestMenu?.getMenuItemById('launch-latest').enabled));
    await page.evaluate(() => window.estraWindow.hideToTray());
    await wait(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible()));
    await app.evaluate(() => global.historyTestMenu.getMenuItemById('launch-latest').click());
    await wait(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
    await page.getByRole('alert').filter({ hasText: 'ไม่พบ FiveM.exe' }).waitFor();
    let history = await page.evaluate(() => JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1')));
    assert.equal(history.length, 2); assert.equal(history[0].status, 'failed');
    assert.match(history[0].error, /ไม่พบ FiveM.exe/);
    await page.reload(); await page.getByRole('button', { name: 'ประวัติการเปิดเกม', exact: true }).click();
    await page.getByRole('dialog').getByText('เปิดไม่สำเร็จ', { exact: true }).waitFor();
    const expectedVersion = process.env.LAUNCHER_EXPECTED_VERSION || '1.7.0';
    await page.screenshot({ path: `tests/artifacts/history-packaged-${expectedVersion}.png`, animations: 'disabled' });
    assert.deepEqual(errors, []);
    const result = { packagedVersion: await app.evaluate(({ app }) => app.getVersion()), trayRestoresAndRunsPreflight: true, invalidPathPreventsRealGameLaunch: true, failureRecorded: true, historySurvivesReload: true, initialSuccessEntryWasFixture: true, actualGameLaunched: false, pageErrors: errors };
    assert.equal(result.packagedVersion, expectedVersion);
    await fs.writeFile(`tests/artifacts/history-packaged-${expectedVersion}.json`, JSON.stringify(result,null,2)); console.log(result);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exit(1); });
