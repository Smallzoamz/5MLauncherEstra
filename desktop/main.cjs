const { app, BrowserWindow, protocol, session, dialog, ipcMain, Tray, Menu } = require('electron');
const { createGameSession } = require('./gameSession.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

protocol.registerSchemesAsPrivileged([{ scheme: 'launcher', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const testProfile = process.env.LAUNCHER_TEST_USER_DATA;
// Preserve the pre-Estra profile, including favorites/settings, across the product rename.
const profilePath = testProfile && path.isAbsolute(testProfile) ? testProfile : path.join(app.getPath('appData'), 'fivem-launcher-prototype');
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);
app.setName('Estra FiveM Launcher');
app.setAppUserModelId('local.fivemlauncher.desktop');
let window, backend, tray, gameSession, closing = false, quitting = false;
let latestCity = { name: '', enabled: false };
const updateTrayMenu = () => {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'เปิด Estra FiveM Launcher', click: restoreWindow },
    { id: 'launch-latest', label: latestCity.name ? 'เข้าเมืองล่าสุด: ' + latestCity.name.replace(/&/g, '&&') : 'เข้าเมืองล่าสุด — ยังไม่มีประวัติ', enabled: latestCity.enabled,
      click: () => { if (!latestCity.enabled || !window || window.isDestroyed()) return; restoreWindow(); window.webContents.send('estra:launch-latest'); } },
    { label: 'ซ่อนลง System Tray', click: hideWindow },
    { type: 'separator' },
    { label: 'ออกจากโปรแกรม', click: () => app.quit() }
  ]));
};
const restoreWindow = () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } };
const hideWindow = () => { if (tray && window && !window.isDestroyed()) window.hide(); };
const ownUrl = value => { try { const u = new URL(value); return u.protocol === 'launcher:' && u.hostname === 'app' && !u.port && !u.username && !u.password; } catch { return false; } };
const trustedWindowSender = event => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && ownUrl(event.senderFrame.url);
ipcMain.on('estra:latest-city', (event, state) => {
  if (!trustedWindowSender(event) || !state || typeof state.name !== 'string' || state.name.length > 100 || /[\x00-\x1f\x7f]/.test(state.name) || typeof state.enabled !== 'boolean') return;
  latestCity = { name: state.name, enabled: !!state.name && state.enabled }; updateTrayMenu();
});
for (const [channel, action] of [
  ['estra:window-minimize', () => window.minimize()],
  ['estra:window-maximize', () => window.isMaximized() ? window.unmaximize() : window.maximize()],
  ['estra:window-hide', hideWindow],
  ['estra:window-close', () => app.quit()]
]) ipcMain.on(channel, event => { if (trustedWindowSender(event)) action(); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', restoreWindow);
  app.whenReady().then(async () => {
    const { startLocalServer } = await import(pathToFileURL(path.join(__dirname, '../src/server/localServer.js')).href);
    const { executeRealLaunch } = await import(pathToFileURL(path.join(__dirname, '../src/server/fivemBackend.js')).href);
    const { getFiveMSessions } = await import(pathToFileURL(path.join(__dirname, '../src/server/systemPresence.js')).href);
    gameSession = createGameSession({ readSessions: getFiveMSessions, hide: hideWindow, restore: restoreWindow, status: state => {
      const messages = { starting: 'กำลังรอ FiveM เปิด', running: 'FiveM กำลังทำงาน', closed: 'FiveM ปิดแล้ว', 'startup-timeout': 'ไม่พบ FiveM หลังส่งคำสั่งเปิด กรุณาลองเปิดใหม่', 'detection-error': 'ตรวจสอบ FiveM ไม่ได้ กรุณาตรวจสอบเกมก่อนเปิดซ้ำ', 'dispatch-error': 'เปิด FiveM ไม่สำเร็จ' };
      tray?.setToolTip('Estra FiveM Launcher · ' + messages[state]);
      if (window && !window.isDestroyed()) window.webContents.send('estra:game-status', { state, message: messages[state] });
    } });
    backend = await startLocalServer({ port: 0, services: { executeRealLaunch: server => gameSession.launch(() => executeRealLaunch(server)) } });
    // Stable renderer origin preserves favorites even though the private backend uses a free port.
    protocol.handle('launcher', async request => {
      if (!ownUrl(request.url)) return new Response('Forbidden', { status: 403 });
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete('host'); headers.delete('referer'); headers.delete('sec-fetch-site');
      headers.set('origin', backend.url);
      const response = await fetch(backend.url + url.pathname + url.search, {
        method: request.method, headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
        redirect: 'error', signal: request.signal
      });
      const outputHeaders = new Headers(response.headers);
        outputHeaders.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: http:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    });
    const ses = session.defaultSession;
    ses.setPermissionCheckHandler((contents, permission, origin, details) =>
      !!contents && ownUrl(contents.getURL()) && ownUrl(origin) && permission === 'media' && details.mediaType !== 'video');
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      const allowed = ownUrl(contents.getURL()) && permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'audio');
      callback(allowed);
    });
    window = new BrowserWindow({
      width: 1280, height: 850, minWidth: 760, minHeight: 620,
      title: 'Estra FiveM Launcher', backgroundColor: '#0b0c0e', show: false, frame: false,
      icon: path.join(__dirname, '../build/icon.ico'),
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false }
    });
    window.removeMenu();
    tray = new Tray(path.join(__dirname, '../build/icon.ico'));
    tray.setToolTip('Estra FiveM Launcher');
    updateTrayMenu();
    tray.on('click', restoreWindow);
    tray.on('double-click', restoreWindow);
    window.on('close', event => { if (!quitting && tray) { event.preventDefault(); hideWindow(); } });
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!ownUrl(url)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('did-start-loading', () => { latestCity = { name: '', enabled: false }; updateTrayMenu(); });
    window.once('ready-to-show', () => window.show());
    await window.loadURL('launcher://app/');
  }).catch(error => {
    const logPath = path.join(app.getPath('userData'), 'startup-error.log');
    try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); fs.writeFileSync(logPath, error.stack || error.message); } catch {}
    dialog.showErrorBox('Estra FiveM Launcher เปิดไม่ได้', `${error.message}\n\nรายละเอียด: ${logPath}`);
    app.quit();
  });
}
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', event => {
  quitting = true;
  gameSession?.dispose();
  tray?.destroy(); tray = null;
  if (backend && !closing) {
    event.preventDefault(); closing = true;
    backend.close().finally(() => app.quit());
  }
});

