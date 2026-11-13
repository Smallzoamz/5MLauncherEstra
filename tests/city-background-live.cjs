const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const cities = [{ id: 'mystic', name: 'Mystic Academy', ip: '147.50.229.43:30120' }, { id: 'wiz', name: 'Wiz Chronicles', ip: 'join.wizchronicles.com:30120' }, { id: 'noxtis', name: 'Noxtis Legacy', ip: '89.38.101.136:30120' }];
    await page.addInitScript(cities => {
      if (!localStorage.getItem('fivem_launcher_servers_v3')) {
        localStorage.setItem('fivem_launcher_servers_v3', JSON.stringify(cities));
        localStorage.setItem('fivem_launcher_active_server_id_v3', cities[0].id);
      }
    }, cities);
    await page.goto(process.env.LAUNCHER_URL || 'http://127.0.0.1:5215');
    const sources = [];
    for (const city of cities) {
      await page.getByRole('button', { name: 'เลือกเมือง ' + city.name, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="รีเฟรช"]')?.disabled && document.querySelector('.selected-city img')?.naturalWidth > 0);
      const server = await page.evaluate(id => JSON.parse(localStorage.getItem('fivem_launcher_servers_v3')).find(s => s.id === id), city.id);
      if (server.bannerUrl) await page.waitForFunction(url => document.querySelector('.city-backdrop.current')?.src === url, server.bannerUrl);
      else await page.waitForFunction(() => document.querySelector('.city-backdrop.current')?.src.startsWith('data:image/svg+xml') && document.querySelector('.city-emblem')?.naturalWidth > 0);
      await page.locator('.city-backdrop.current').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      sources.push({ city: city.name, declaredBanner: server.bannerUrl || null, current: await page.locator('.city-backdrop.current').getAttribute('src') });
      await page.screenshot({ path: `tests/artifacts/city-${city.id}-1.5.0.png` });
    }
    assert.notEqual(sources[0].current, sources[1].current);
    const city = cities[0];
    await page.getByRole('button', { name: 'เลือกเมือง ' + city.name, exact: true }).click();
    await page.locator('#server-config summary').click();
    const image = await fs.readFile('tests/fixtures/server-icon.png');
    await page.route('https://custom.example/city.png', route => route.fulfill({ contentType: 'image/png', body: image }));
    await page.getByLabel('รูปพื้นหลังเมือง (URL รูปภาพ)', { exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'บันทึกรูป', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'HTTP หรือ HTTPS' }).waitFor();
    await page.getByLabel('รูปพื้นหลังเมือง (URL รูปภาพ)', { exact: true }).fill('https://custom.example/city.png');
    await page.getByRole('button', { name: 'บันทึกรูป', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.city-backdrop.current')?.src === 'https://custom.example/city.png');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.city-backdrop.current')?.src === 'https://custom.example/city.png');
    await page.locator('#server-config summary').click();
    await page.getByLabel('รูปพื้นหลังเมือง (URL รูปภาพ)', { exact: true }).fill('');
    await page.getByRole('button', { name: 'บันทึกรูป', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.city-backdrop.current')?.src.startsWith('data:image/svg+xml'));
    assert.deepEqual(errors, []);
    const evidence = { cities: sources.map(({ current, ...s }) => ({ ...s, source: current.startsWith('data:') ? 'city theme and actual city icon' : current })), distinctCityThemes: true, customBannerWorks: true, persistedAcrossReload: true, clearRestoresAuto: true, invalidUrlRejected: true, pageErrors: errors };
    await fs.writeFile('tests/artifacts/city-background-1.5.0.json', JSON.stringify(evidence, null, 2)); console.log(evidence);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
