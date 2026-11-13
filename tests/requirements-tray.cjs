const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const profile = await fs.mkdtemp(path.resolve('tests/artifacts/requirements-tray-profile-'));
  const env = { ...process.env, LAUNCHER_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: ['tests/tray-harness.cjs'], env, cwd: process.cwd() });
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('launcher://app/'); await page.locator('#selected-server').waitFor();
    const fixture = await app.evaluate(() => global.estraTest.fixture);
    await page.evaluate(fivemPath => {
      localStorage.setItem('fivem_launcher_servers_v3', JSON.stringify([{ id: 'requirements', name: 'Requirements Test City', ip: 'example.com:30120', cl2: false }]));
      localStorage.setItem('fivem_launcher_settings_v3', JSON.stringify({ fivemPath, checkMicBeforeLaunch: false, autoClearCacheBeforeLaunch: false }));
    }, fixture);
    await page.reload(); await page.locator('#selected-server').waitFor();
    await page.locator('.session-stats strong').filter({ hasText: /^3095$/ }).waitFor();
    const wait = async check => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw Error('Condition timed out');
    };
    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
    await app.evaluate(() => { global.estraTest.requirements = { sv_enforceGameBuild: '3258', sv_pureLevel: '0' }; });
    await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await wait(() => app.evaluate(() => global.estraTest.dispatchedArgs.length === 1));
    assert.deepEqual(await app.evaluate(() => global.estraTest.dispatchedArgs[0]), ['-b3258', '-pure_0', 'fivem://connect/example.com:30120']);
    await page.locator('.session-stats strong').filter({ hasText: /^3258$/ }).waitFor();
    await wait(visible);
    await app.evaluate(() => { global.estraTest.requirements = { sv_enforceGameBuild: '3095', sv_pureLevel: '1' }; });
    const readsBeforeTray = await app.evaluate(() => global.estraTest.infoReads);
    await app.evaluate(() => global.estraTest.menu.getMenuItemById('launch-latest').click());
    await wait(() => app.evaluate(() => global.estraTest.dispatchedArgs.length === 2));
    assert.deepEqual(await app.evaluate(() => global.estraTest.dispatchedArgs[1]), ['-b3095', '-pure_1', 'fivem://connect/example.com:30120']);
    assert.ok(await app.evaluate((_, before) => global.estraTest.infoReads > before, readsBeforeTray));
    await wait(visible);
    await app.evaluate(() => { global.estraTest.requirements = {}; });
    await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'ตรวจสอบ Game Build' }).waitFor();
    assert.equal(await app.evaluate(() => global.estraTest.dispatchedArgs.length), 2);
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1')));
    assert.deepEqual(history.map(entry => entry.status), ['failed', 'sent', 'sent']);
    assert.deepEqual(errors, []);
    const evidence = { playUsesChangedRequirements: true, pureZeroApplied: true, trayRechecksRequirements: true, missingRequirementsPreventDispatch: true, failureRecorded: true, pageErrors: errors, actualGameLaunched: false };
    await fs.writeFile('tests/artifacts/requirements-tray.json', JSON.stringify(evidence, null, 2));
    console.log(evidence);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exit(1); });
