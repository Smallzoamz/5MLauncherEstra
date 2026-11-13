const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const stage = process.env.LAUNCHER_DESKTOP_STAGE || (process.env.LAUNCHER_PACKAGED_EXE ? 'packaged' : 'development');
  const profile = path.resolve('tests/artifacts/desktop-profile-' + stage);
  await fs.mkdir(profile, { recursive: true });
  const env = { ...process.env, LAUNCHER_TEST_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({
    executablePath: process.env.LAUNCHER_PACKAGED_EXE || require('electron'),
    args: [...(process.env.LAUNCHER_PACKAGED_EXE ? [] : ['.']), '--use-fake-device-for-media-stream'],
    cwd: process.cwd(), env, timeout: 30000
  });
  let app = await launch();
  try {
    const page = await app.firstWindow();
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    await page.waitForURL('launcher://app/');
    await page.locator('#selected-server').waitFor();
    if (process.env.LAUNCHER_EXPECT_FIVEM_RUNNING === '0') {
      await page.waitForFunction(() => document.querySelector('#fivem-process-status')?.textContent.includes('FiveM ยังไม่ได้เปิด'));
      assert.equal(await page.getByRole('button', { name: 'กดเล่น', exact: true }).isEnabled(), true);
    }
    if (process.env.LAUNCHER_EXPECT_FIVEM_RUNNING === '1') {
      await page.waitForFunction(() => document.querySelector('#fivem-process-status')?.textContent.includes('FiveM กำลังทำงานอยู่'));
      const play = page.getByRole('button', { name: 'กดเล่น', exact: true });
      const cl2 = page.getByRole('switch', { name: 'เปิด FiveM ตัวที่สอง (Legacy)' });
      assert.equal(await play.isDisabled(), true);
      await cl2.click(); assert.equal(await play.isEnabled(), true);
      await cl2.click(); assert.equal(await play.isDisabled(), true);
    }
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/installation');
      const installation = await response.json();
      const forbidden = await fetch('/api/launch-fivem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const token = (await (await fetch('/api/session')).json()).token;
      const rejected = await fetch('/api/launch-fivem', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
        body: JSON.stringify({ ip: 'invalid&command', fivemPath: 'C:/Invalid' })
      });
      return { origin: location.origin, installationFound: installation.success, unauthorized: forbidden.status, invalidInput: rejected.status, hasNode: typeof window.require !== 'undefined', secure: isSecureContext };
    });
    assert.equal(result.origin,'launcher://app'); assert.equal(result.installationFound,true);
    assert.equal(result.unauthorized,403); assert.equal(result.invalidInput,400); assert.equal(result.hasNode,false); assert.equal(result.secure,true);
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]; const p = win.webContents.getLastWebPreferences();
      return { sandbox:p.sandbox, contextIsolation:p.contextIsolation, nodeIntegration:p.nodeIntegration };
    });
    assert.deepEqual(prefs,{sandbox:true,contextIsolation:true,nodeIntegration:false});
    if (process.env.LAUNCHER_EXPECT_FIVEM_RUNNING === '1') result.runningGameGuard = true;
    const media = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = stream.getAudioTracks().length === 1;
      stream.getTracks().forEach(track => track.stop());
      let videoDenied = false;
      try { const camera = await navigator.mediaDevices.getUserMedia({ video: true }); camera.getTracks().forEach(track => track.stop()); }
      catch { videoDenied = true; }
      return { audio, videoDenied };
    });
    assert.deepEqual(media, { audio: true, videoDenied: true });
    assert.equal(await page.evaluate(async () => (await fetch('/assets/roleplay-night.png')).status),200);
    if (process.env.LAUNCHER_EXPECT_BANNER === '1') {
      const banner = await page.evaluate(async () => (await (await fetch('/api/server-query?target=89.38.101.136:30120')).json()).bannerUrl);
      assert.ok(banner, 'live server reports a banner');
      await page.waitForFunction(url => {
        const image = document.querySelector('.city-backdrop.current');
        return image?.src === url && image.naturalWidth > 0;
      }, banner, {timeout:20000});
      await page.locator('.city-backdrop.current').evaluate(el => Promise.all(el.getAnimations().map(a=>a.finished)));
      result.serverBanner = true;
    }
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:'tests/artifacts/desktop-' + stage + '-main.png'});
    await page.evaluate(() => localStorage.setItem('installer-smoke-persistence','saved'));
    await page.getByRole('button',{name:'การตั้งค่า',exact:true}).click();
    await page.getByRole('button',{name:'ตรวจสอบพาธ',exact:true}).click();
    await page.getByRole('status').filter({hasText:'พบ FiveM'}).waitFor();
    await page.screenshot({path:'tests/artifacts/desktop-' + stage + '.png'});
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.open('https://example.com'));
    assert.equal((await app.windows()).length,1);
    assert.deepEqual(errors,[]);
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.waitForURL('launcher://app/');
    assert.equal(await reopened.evaluate(()=>localStorage.getItem('installer-smoke-persistence')),'saved');
    await fs.writeFile('tests/artifacts/desktop-' + stage + '.json',JSON.stringify({stage,...result,...prefs,...media,persistence:true,pageErrors:errors},null,2));
    console.log(JSON.stringify({stage,...result,...prefs,...media,persistence:true,pageErrors:errors},null,2));
  } finally { await app.close(); }
})().catch(e => {console.error(e);process.exit(1)});

