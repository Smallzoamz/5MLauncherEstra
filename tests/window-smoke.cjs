const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
(async()=>{
  const stage=process.env.LAUNCHER_DESKTOP_STAGE || 'development-estra';
  const profile=path.resolve('tests/artifacts/window-profile-'+stage);
  const env={...process.env,LAUNCHER_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  let app=await electron.launch({executablePath:process.env.LAUNCHER_PACKAGED_EXE || require('electron'),args:process.env.LAUNCHER_PACKAGED_EXE?[]:['.'],env,cwd:process.cwd()});
  try {
    const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForURL('launcher://app/');await page.locator('#selected-server').waitFor();
    assert.equal(await page.title(),'Estra FiveM Launcher');
    const native=await app.evaluate(({app,BrowserWindow})=>({name:app.getName(),title:BrowserWindow.getAllWindows()[0].getTitle(),exe:process.execPath,profile:app.getPath('userData'),session:app.getPath('sessionData'),handle:BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString()}));
    assert.equal(native.name,'Estra FiveM Launcher');assert.equal(native.title,native.name);
    assert.equal(native.profile,profile);assert.equal(native.session,profile);
    if(process.env.LAUNCHER_PACKAGED_EXE) assert.equal(path.basename(native.exe),'Estra FiveM Launcher.exe');
    // Electron retains some Win32 style flags for window behavior. Verify the actual
    // non-client area instead: no titlebar/border may take space from the web content.
    const geometry=await app.evaluate(({BrowserWindow})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),content:BrowserWindow.getAllWindows()[0].getContentBounds()}));
    assert.deepEqual(geometry.content,geometry.bounds,'web content must fill the native window with no OS titlebar');
    const ui=await page.evaluate(()=>({api:Object.keys(window.estraWindow).sort(),node:typeof window.require,bodyPadding:getComputedStyle(document.body).padding,border:getComputedStyle(document.querySelector('.launcher-window')).borderWidth,drag:getComputedStyle(document.querySelector('.header-wrap')).webkitAppRegion,menuDrag:getComputedStyle(document.querySelector('.window-menu')).webkitAppRegion,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.deepEqual(ui.api,['close','hideToTray','minimize','onGameStatus','onLaunchLatest','setLatestCity','toggleMaximize']);assert.equal(ui.node,'undefined');assert.equal(ui.bodyPadding,'0px');assert.equal(ui.border,'0px');assert.equal(ui.drag,'drag');assert.equal(ui.menuDrag,'no-drag');assert.equal(ui.overflow,false);
    assert.equal(await app.evaluate(({ipcMain,BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];ipcMain.emit('estra:window-minimize',{sender:w.webContents,senderFrame:{url:'https://evil.example'}});return w.isMinimized();}),false);
    await page.waitForFunction(()=>document.querySelector('.estra-brand img')?.naturalWidth>0);
    const settle=async(maximized)=>{for(let i=0;i<60;i++){if(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized())===maximized)return;await new Promise(r=>setTimeout(r,50));}throw Error('window state did not settle');};
    const menu=page.getByLabel('เมนูหน้าต่าง Estra',{exact:true});
    await menu.click();await page.getByRole('button',{name:'ขยาย / คืนขนาดหน้าต่าง',exact:true}).click();await settle(true);
    await menu.click();await page.getByRole('button',{name:'ขยาย / คืนขนาดหน้าต่าง',exact:true}).click();await settle(false);
    await menu.click();await page.getByRole('button',{name:'ย่อหน้าต่าง',exact:true}).click();
    for(let i=0;i<60 && !await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized());i++) await new Promise(r=>setTimeout(r,50));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized()),true);
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.focus();});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false,'native close must hide to Tray');
    await app.evaluate(({app})=>app.emit('second-instance'));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true,'reopening the app must restore the tray window');
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`tests/artifacts/estra-${stage}.png`});
    await menu.click();await page.screenshot({path:`tests/artifacts/estra-menu-${stage}.png`});await page.keyboard.press('Escape');
    assert.equal(await page.locator('.window-menu').getAttribute('open'),null);
    assert.deepEqual(errors,[]);
    await menu.click();
    const closing=await Promise.allSettled([app.waitForEvent('close'),page.getByRole('button',{name:'ปิดโปรแกรม',exact:true}).click()]);
    assert.equal(closing[0].status,'fulfilled','close control must actually exit the application');
    if(closing[1].status==='rejected') assert.match(closing[1].reason.message,/Target page, context or browser has been closed/);
    app=null;
    const evidence={stage,appName:native.name,executable:path.basename(native.exe),nativeCaption:false,outerPadding:false,limitedBridge:true,untrustedSenderRejected:true,minimize:true,maximizeRestore:true,nativeCloseHidesToTray:true,secondInstanceRestores:true,close:true,pageErrors:errors};
    await fs.writeFile(`tests/artifacts/window-${stage}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
  } finally {if(app)await app.close();}
})().catch(e=>{console.error(e);process.exit(1)});
