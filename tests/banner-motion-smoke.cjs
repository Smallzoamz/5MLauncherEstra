const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const cities=['Amber','Blue','Broken','Empty','Slow'];
    await page.addInitScript(cities=>{
      localStorage.setItem('fivem_launcher_servers_v3',JSON.stringify(cities.map(name=>({id:name,name,ip:name.toLowerCase()+'.example:30120',tag:'Roleplay'}))));
      localStorage.setItem('fivem_launcher_active_server_id_v3','Amber');
    },cities);
    let releaseSlow, slowStarted;
    const slowGate=new Promise(resolve=>{releaseSlow=resolve});
    const slowRequested=new Promise(resolve=>{slowStarted=resolve});
    const image=await fs.readFile('tests/fixtures/server-icon.png');
    await page.route('https://banner.example/**',async route=>{
      const name=route.request().url().split('/').at(-1);
      if(name==='broken.png') return route.fulfill({status:404,body:'missing'});
      if(name==='slow.png'){slowStarted();await slowGate;}
      return route.fulfill({contentType:'image/png',body:image});
    });
    await page.route('**/api/server-query?*',route=>{
      const name=new URL(route.request().url()).searchParams.get('target').split('.')[0];
      return route.fulfill({json:{online:true,status:'Online',clients:5,maxClients:80,bannerUrl:name==='empty'?null:`https://banner.example/${name}.png`,connectingBannerUrl:name==='broken'?'https://banner.example/connecting.png':null}});
    });
    await page.goto(process.env.LAUNCHER_URL || 'http://127.0.0.1:5199');
    const waitImage=name=>page.waitForFunction(name=>document.querySelector('.city-backdrop.current')?.src.endsWith(name),name);
    await waitImage('amber.png');
    const css=await page.locator('.city-backdrop.current').evaluate(el=>({name:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration}));
    assert.equal(css.name,'banner-reveal');assert.ok(parseFloat(css.duration)>0.3);
    await page.getByRole('button',{name:'เลือกเมือง Blue',exact:true}).click();
    await waitImage('blue.png');
    await page.locator('.city-backdrop.current').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
    assert.equal(await page.locator('.city-backdrop.previous').count(),0);
    await page.getByRole('button',{name:'เลือกเมือง Broken',exact:true}).click();
    await waitImage('connecting.png');
    await page.getByRole('button',{name:'เลือกเมือง Empty',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.city-backdrop.current')?.src.startsWith('data:image/svg+xml'));
    const emptyTheme=await page.locator('.city-backdrop.current').getAttribute('src');
    assert.ok(emptyTheme.length>100);
    await page.getByRole('button',{name:'เลือกเมือง Slow',exact:true}).click();
    await slowRequested;
    await page.getByRole('button',{name:'เลือกเมือง Blue',exact:true}).click();
    await waitImage('blue.png');
    const lateResponse=page.waitForResponse('https://banner.example/slow.png');
    releaseSlow();await lateResponse;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok((await page.locator('.city-backdrop.current').getAttribute('src')).endsWith('blue.png'),'late image cannot overwrite the selected city');
    await page.getByRole('button',{name:'การตั้งค่า',exact:true}).click();
    assert.equal(await page.getByRole('dialog').evaluate(el=>getComputedStyle(el).animationName),'dialog-in');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'การตั้งค่า',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button',{name:'เลือกเมือง Amber',exact:true}).click();
    await waitImage('amber.png');
    assert.equal(await page.locator('.city-backdrop.current').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.waitForFunction(()=>!document.querySelector('.city-backdrop.previous'));
    for(const width of [900,390,320]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:['selected city detail banner','crossfade and layer cleanup','broken detail uses connecting banner','no banner uses fallback','late load cannot overwrite new city','dialog enter/exit/reopen','reduced motion cleanup','responsive overflow'],pageErrors:errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
