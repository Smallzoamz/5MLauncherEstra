const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const base = process.env.LAUNCHER_URL || 'http://127.0.0.1:5216';
    const presence = await (await fetch(base + '/api/system-presence')).json();
    assert.ok(presence.steam.user?.displayName); assert.ok(presence.discord.user?.displayName);
    await page.addInitScript(() => {
      localStorage.setItem('fivem_launcher_settings_v3', JSON.stringify({ checkMicBeforeLaunch: false, autoClearCacheBeforeLaunch: false }));
      localStorage.setItem('fivem_launcher_servers_v3', JSON.stringify([{ id: 'fixture', name: 'Estra Test City', ip: 'fixture.example:30120' }]));
    });
    let serverStatus = 'Online';
    await page.route('**/api/system-presence', route => route.fulfill({ json: { ...presence, fivem: { running: false } } }));
    await page.route('**/api/server-query?*', route => route.fulfill({ json: { online: serverStatus === 'Online', status: serverStatus, clients: serverStatus === 'Online' ? 12 : null, maxClients: serverStatus === 'Online' ? 100 : null } }));
    await page.route('**/api/installation?*', route => route.fulfill({ json: { success: true, exe: 'C:/Fixture/FiveM.exe' } }));
    let launchBody;
    await page.route('**/api/launch-fivem', async route => { launchBody = route.request().postDataJSON(); await route.fulfill({ json: { success: true, message: 'Fixture launch' } }); });
    await page.goto(base);
    for (const key of ['steam', 'discord']) {
      await page.locator(`[data-account="${key}"]`).getByText(presence[key].user.displayName, { exact: true }).waitFor();
      await page.waitForFunction(key => document.querySelector(`[data-account="${key}"] img`)?.naturalWidth > 0, key);
    }
    for (const next of ['Offline', 'Unknown', 'Online']) {
      serverStatus = next;
      const response = page.waitForResponse(r => r.url().includes('/api/server-query?'));
      await page.getByRole('button', { name: 'รีเฟรช', exact: true }).click();
      await response;
      await page.waitForFunction(text => document.querySelector('.population-row .live-label')?.textContent.trim() === text, next === 'Unknown' ? 'ตรวจสอบไม่ได้' : next);
      assert.equal((await page.locator('.population-row .live-label').innerText()).trim(), next === 'Unknown' ? 'ตรวจสอบไม่ได้' : next);
      if (next === 'Offline') assert.ok((await page.locator('.population-row strong').innerText()).includes('—'));
    }
    await page.locator('#server-config summary').click();
    await page.getByLabel('Name ใน FiveM', { exact: true }).fill('Sora Kitagawa');
    await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Fixture launch' }).waitFor();
    assert.equal(launchBody.inGameName, 'Sora Kitagawa');
    let release; const gate = new Promise(r => { release = r; }); let cleanupBody;
    await page.route('**/api/maintenance-preview?*', route => route.fulfill({ json: { groups: ['logs', 'crashes', 'shaders'].map(category => ({ category, files: 2, bytes: 1024 })) } }));
    await page.route('**/api/clean-maintenance', async route => { cleanupBody = route.request().postDataJSON(); await gate; await route.fulfill({ json: { success: true, deletedFiles: 4, deletedBytes: 2048, steps: ['logs: ล้างแล้ว', 'shaders: ล้างแล้ว'] } }); });
    await page.getByRole('button', { name: 'การตั้งค่า', exact: true }).click();
    const cleanButton = page.getByRole('button', { name: 'ล้างประเภทที่เลือก', exact: true });
    assert.equal(await cleanButton.isDisabled(), true);
    await page.getByRole('button', { name: 'ตรวจไฟล์และขนาด', exact: true }).click();
    await page.getByText('2 ไฟล์ · 1.0 KB', { exact: true }).first().waitFor();
    await page.getByRole('checkbox', { name: /Log ของ FiveM/ }).check();
    await page.getByRole('checkbox', { name: /Shader \/ GPU cache ของ FiveM/ }).check();
    await page.screenshot({ path: 'tests/artifacts/maintenance-settings-1.6.0.png' });
    await cleanButton.click();
    await page.getByRole('button', { name: 'กำลังทำงาน…', exact: true }).waitFor();
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').isVisible(), true);
    assert.equal(await page.getByLabel('ตำแหน่ง FiveM.exe หรือโฟลเดอร์ติดตั้ง').isDisabled(), true);
    release(); await page.getByRole('status').filter({ hasText: 'ล้างแล้ว 4 ไฟล์' }).waitFor();
    assert.deepEqual(cleanupBody.categories, ['logs', 'shaders']);
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.locator('#server-config summary').click();
    for (const width of [1280, 900, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'overflow at ' + width);
      if ([1280, 390].includes(width)) await page.screenshot({ path: `tests/artifacts/accounts-${width}-1.6.0.png` });
    }
    assert.deepEqual(errors, []);
    const evidence = { currentSteam: presence.steam.user.displayName, currentDiscord: presence.discord.user.displayName, actualAvatarsLoaded: true, offlineAndUnknownDistinct: true, nicknameSentToLaunch: true, maintenanceSelectionAndPreview: true, escapeBlockedWhileCleaning: true, realGameLaunched: false, liveFilesDeleted: false, responsiveWidths: [1280, 900, 390, 320], pageErrors: errors };
    await fs.writeFile('tests/artifacts/release16-ui.json', JSON.stringify(evidence, null, 2)); console.log(evidence);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
