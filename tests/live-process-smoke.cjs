const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async()=>{
  const base=process.env.LAUNCHER_URL || 'http://127.0.0.1:5199';
  const presence=await (await fetch(base+'/api/system-presence')).json();
  assert.equal(presence.fivem.running,true,'This read-only live check requires an already-running FiveM process');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'launcher-live-guard-'));
  let browser;
  try {
    // Never point the test launch at the actual installed game, even if it exits mid-test.
    await fs.writeFile(path.join(root,'FiveM.exe'),'TEST FIXTURE - NOT EXECUTABLE');
    const {token}=await (await fetch(base+'/api/session')).json();
    const response=await fetch(base+'/api/launch-fivem',{method:'POST',headers:{'Content-Type':'application/json','X-Launcher-Token':token},body:JSON.stringify({ip:'example.com:30120',fivemPath:root,cl2:false})});
    assert.equal(response.status,409);
    const body=await response.json();assert.match(body.error,/FiveM กำลังทำงานอยู่/);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#fivem-process-status')?.textContent.includes('FiveM กำลังทำงานอยู่'));
    const play=page.getByRole('button',{name:'กดเล่น',exact:true});
    assert.equal(await play.isDisabled(),true);
    await page.waitForFunction(()=>document.querySelector('.city-backdrop.current')?.src.startsWith('https://'));
    await page.locator('.city-backdrop.current').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
    await page.screenshot({path:'tests/artifacts/process-guard-live.png',fullPage:true});
    const cl2=page.getByRole('switch',{name:'เปิด FiveM ตัวที่สอง (Legacy)'});
    await cl2.click();assert.equal(await play.isEnabled(),true);
    await cl2.click();assert.equal(await play.isDisabled(),true);
    const evidence={actualWindowsProcessDetected:true,normalLaunchHttp:response.status,playDisabled:true,cl2EnablesPlay:true,realGameLaunch:false,gameProcessModified:false};
    await fs.writeFile('tests/artifacts/process-guard-live.json',JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence,null,2));
  } finally {
    if(browser)await browser.close();
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('launcher-live-guard-'));
    await fs.rm(root,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exit(1)});
