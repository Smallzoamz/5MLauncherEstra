const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    const icon = 'data:image/png;base64,' + (await fs.readFile('tests/fixtures/server-icon.png')).toString('base64');
    const longName = 'เมืองทดสอบชื่อยาวมาก '.repeat(5).slice(0,100);
    await page.addInitScript(({longName}) => {
      localStorage.setItem('fivem_launcher_servers_v3',JSON.stringify([
        {id:'city',name:'Noxtis Legacy',ip:'example.com:30120',tag:'Roleplay',logoUrl:'https://old.invalid/wrong-scene.png'},
        {id:'long',name:longName,ip:'second.example.com:30120',tag:'Training'}
      ]));
      localStorage.setItem('fivem_launcher_active_server_id_v3','city');
    }, {longName});
    let iconMode='valid', oldImageRequests=0;
    page.on('request',r=>{if(r.url().includes('old.invalid')) oldImageRequests++;});
    await page.route('**/api/server-query?*', route=>route.fulfill({json:{online:true,status:'Online',clients:5,maxClients:80,logoUrl:iconMode==='valid'?icon:iconMode==='broken'?'data:image/png;base64,invalid':null,iconSource:iconMode==='absent'?null:'server-icon-v1'}}));
    await page.goto(process.env.LAUNCHER_URL || 'http://127.0.0.1:5199');
    await page.getByText('5 / 80',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.selected-city img')?.naturalWidth===96);
    assert.equal(await page.locator('.selected-city img').getAttribute('src'),icon);
    assert.equal(oldImageRequests,0);
    assert.equal(await page.locator('.selected-city img').evaluate(el=>getComputedStyle(el).objectFit),'contain');
    iconMode='broken'; await page.getByRole('button',{name:'รีเฟรช',exact:true}).click();
    await page.locator('.selected-city img').waitFor({state:'detached'});
    assert.equal(await page.locator('.selected-city .server-avatar').innerText(),'NO');
    iconMode='absent';
    await page.getByRole('button',{name:'ดูรายการเมืองทั้งหมด'}).click();
    await page.getByRole('button',{name:'Training',exact:true}).click();
    assert.equal(await page.locator('.library-select').count(),1);
    await page.getByRole('textbox',{name:'ค้นหาเมือง'}).fill('missing');
    assert.equal(await page.locator('.library-select').count(),0);
    await page.getByRole('textbox',{name:'ค้นหาเมือง'}).fill('second');
    await page.locator('.library-select').click();
    assert.equal((await page.locator('#selected-server').innerText()).replace(/\s+/g,' '),longName.trim());
    for(const width of [1366,900,390,320]) {
      await page.setViewportSize({width,height:900});
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,actions:document.querySelector('.hero-actions').getBoundingClientRect().bottom,cards:document.querySelector('.dashboard-heading').getBoundingClientRect().top,animation:getComputedStyle(document.querySelector('.hero-copy')).animationDuration}));
      assert.equal(layout.overflow,false,'long title overflow '+width);
      assert.ok(layout.actions<layout.cards,'title/actions overlap cards '+width);
      assert.ok(parseFloat(layout.animation)<0.01,'reduced motion');
    }
    await page.screenshot({path:'tests/artifacts/long-title-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:['verified icon displayed at native ratio','legacy image never requested','broken icon initials fallback','library search/filter/select','100-character Thai title at 1366/900/390/320','reduced motion'],pageErrors:errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
