const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem('history-test-seeded')) {
        localStorage.setItem('history-test-seeded', '1');
        localStorage.setItem('fivem_launcher_settings_v3', JSON.stringify({ checkMicBeforeLaunch: false }));
        localStorage.setItem('fivem_launcher_servers_v3', JSON.stringify([{ id: 'a', name: 'Estra Test City', ip: 'fixture.example:30120' }, { id: 'b', name: 'Second City', ip: 'second.example:30120' }]));
      }
    });
    await page.route('**/api/system-presence', r => r.fulfill({ json: { steam: { running: true }, discord: { running: true }, fivem: { running: false } } }));
    await page.route('**/api/server-query?*', r => r.fulfill({ json: { status: 'Online', online: true, clients: 24, maxClients: 100 } }));
    await page.route('**/api/installation?*', r => r.fulfill({ json: { success: true } }));
    let fail = false, held = null; const launches = [];
    await page.route('**/api/launch-fivem', async r => { launches.push(r.request().postDataJSON()); if (held) await held; await r.fulfill({ status: fail ? 503 : 200, json: fail ? { success: false, error: 'ทดสอบ: ส่งคำสั่งเปิดไม่ได้' } : { success: true, message: 'ส่งคำสั่งทดสอบแล้ว' } }); });
    await page.goto(process.env.LAUNCHER_URL || 'http://127.0.0.1:5217');
    const openHistory = () => page.getByRole('button', { name: 'ประวัติการเปิดเกม', exact: true }).click();
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1') || '[]'));
    await openHistory(); await page.getByText('ยังไม่มีประวัติการเปิดเกม', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await page.getByText('ส่งคำสั่งทดสอบแล้ว', { exact: true }).waitFor();
    assert.equal((await read())[0].status, 'sent');
    // A second click path while dispatch is pending cannot create another attempt.
    let release; held = new Promise(r => { release = r; });
    await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1'))[0].status === 'preparing');
    await page.getByRole('button', { name: 'เลือกเมือง Second City', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'กดเล่น', exact: true }).isDisabled(), true);
    await openHistory(); assert.equal(await page.getByRole('button', { name: 'เข้าเมืองล่าสุด', exact: true }).isDisabled(), true);
    release(); held = null;
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1'))[0].status === 'sent');
    assert.equal(launches.length, 2); assert.equal(launches[1].ip, 'fixture.example:30120');
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    fail = true; await page.getByRole('button', { name: 'กดเล่น', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'ทดสอบ: ส่งคำสั่งเปิดไม่ได้' }).waitFor();
    await openHistory(); const dialog = page.getByRole('dialog');
    await dialog.getByText('เปิดไม่สำเร็จ', { exact: true }).waitFor();
    assert.equal((await read())[0].city.id, 'b');
    assert.equal(await dialog.locator('.history-latest strong').innerText(), 'Estra Test City');
    await page.reload(); await openHistory(); assert.equal((await read()).length, 3);
    for (const width of [1280, 900, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'overflow at ' + width);
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false, 'dialog overflow at ' + width);
      if ([1280, 390].includes(width)) await page.screenshot({ path: `tests/artifacts/history-${width}-1.7.0.png`, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    // Current settings are used when replaying; historical settings remain unchanged.
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'เลือกเมือง Estra Test City', exact: true }).click();
    await page.getByRole('switch', { name: 'เปิด FiveM ตัวที่สอง (Legacy)' }).click();
    await openHistory(); fail = false;
    await page.getByRole('button', { name: 'เข้าเมืองล่าสุด', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1')).length === 4 && JSON.parse(localStorage.getItem('fivem_launcher_launch_history_v1'))[0].status === 'sent');
    assert.equal(launches.at(-1).cl2, true);
    await page.evaluate(() => { const list = JSON.parse(localStorage.getItem('fivem_launcher_servers_v3')); list[0].ip = 'changed.example:30120'; localStorage.setItem('fivem_launcher_servers_v3', JSON.stringify(list)); });
    await page.reload(); await openHistory();
    assert.equal(await page.getByRole('button', { name: 'เข้าเมืองล่าสุด', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'เปิด Estra Test City อีกครั้ง', exact: true }).first().isDisabled(), true);
    await page.getByRole('button', { name: 'ล้างประวัติ', exact: true }).click();
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click(); assert.equal((await read()).length, 4);
    await page.getByRole('button', { name: 'ล้างประวัติ', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันล้างประวัติ', exact: true }).click();
    assert.equal((await read()).length, 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fivem_launcher_servers_v3')).length), 2);
    await page.reload(); await openHistory(); await page.getByText('ยังไม่มีประวัติการเปิดเกม', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    const result = { successAndFailure: true, persistent: true, duplicateGuardAcrossCitySwitch: true, currentSettingsOnReplay: true, changedAddressBlocked: true, confirmedClearPreservesFavorites: true, responsiveWidths: [1280,900,390,320], actualGameLaunched: false, pageErrors: errors };
    await fs.writeFile('tests/artifacts/history-ui-1.7.0.json', JSON.stringify(result,null,2)); console.log(result);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
