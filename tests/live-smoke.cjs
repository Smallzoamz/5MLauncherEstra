const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
(async () => {
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1366,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.LAUNCHER_URL || 'http://127.0.0.1:5199');
 await page.waitForFunction(()=>!document.querySelector('[aria-label=รีเฟรช]')?.disabled);
 const live=await page.evaluate(async()=>({
   installation:await (await fetch('/api/installation')).json(),
   presence:await (await fetch('/api/system-presence')).json(),
   server:await (await fetch('/api/server-query?target=89.38.101.136:30120')).json(),
   overflow:document.documentElement.scrollWidth>innerWidth
 }));
 assert.equal(live.installation.success,true);assert.equal(live.overflow,false);assert.deepEqual(errors,[]);
 const actualInfo = await (await fetch('http://89.38.101.136:30120/info.json', {signal:AbortSignal.timeout(10000)})).json();
 assert.equal(live.server.logoUrl, 'data:image/png;base64,' + actualInfo.icon, 'city logo must equal the icon reported by this server');
 await page.waitForFunction(()=>document.querySelector('.selected-city img')?.naturalWidth>0);
 assert.equal(await page.locator('.selected-city img').getAttribute('src'), live.server.logoUrl);
 if (live.server.bannerUrl) {
   await page.waitForFunction(url=>{
     const image=document.querySelector('.city-backdrop.current');
     return image?.src===url && image.naturalWidth>0;
   },live.server.bannerUrl,{timeout:20000});
   await page.locator('.city-backdrop.current').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
 }
 await page.screenshot({path:'tests/artifacts/live-desktop.png',fullPage:true});
 await fs.writeFile('tests/artifacts/live-smoke.json',JSON.stringify({...live,pageErrors:errors},null,2));
 console.log(JSON.stringify({installationFound:live.installation.success,steam:live.presence.steam.running,discord:live.presence.discord.running,server:{...live.server,logoUrl:live.server.logoUrl?.slice(0,32)},pageErrors:errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

