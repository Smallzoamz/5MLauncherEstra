// Test-only entrypoint: exercise the real desktop main, IPC, API and Tray with
// controlled tasklist/dispatch results. Never execute the user's FiveM.
const electron = require('electron');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fixture = path.resolve('tests/artifacts/tray-fake-install');
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(path.join(fixture, 'FiveM.exe'), 'NON-EXECUTABLE TEST FIXTURE');
global.estraTest = { pids: [], trays: [], dispatches: 0, failDispatch: false, fixture,
  requirements: { sv_enforceGameBuild: '3095', sv_pureLevel: '2' }, infoReads: 0, dispatchedArgs: [] };
const originalFetch = global.fetch;
global.fetch = async (input, options) => {
  if (String(input) === 'http://example.com:30120/info.json') {
    global.estraTest.infoReads++;
    return Response.json({ vars: global.estraTest.requirements });
  }
  if (String(input) === 'http://example.com:30120/dynamic.json') return Response.json({ clients: 0, sv_maxclients: 32 });
  return originalFetch(input, options);
};
const originalExec = cp.execFile;
cp.execFile = (exe, args, options, callback) => {
  if (exe === 'tasklist.exe') {
    queueMicrotask(() => callback(null, '"explorer.exe","999","Console","1","10 K"\r\n' + global.estraTest.pids.map(pid => `"FiveM_b3258_GTAProcess.exe","${pid}","Console","1","10 K"`).join('\r\n'), ''));
    return {};
  }
  if (path.basename(exe).toLowerCase() === 'powershell.exe') {
    global.estraTest.dispatches++;
    if (options.env?.ESTRA_LAUNCH_PAYLOAD) global.estraTest.dispatchedArgs.push(JSON.parse(Buffer.from(options.env.ESTRA_LAUNCH_PAYLOAD, 'base64').toString()).args);
    queueMicrotask(() => callback(global.estraTest.failDispatch ? Error('Test dispatch failure') : null, '', ''));
    return {};
  }
  return originalExec(exe, args, options, callback);
};
cp.execFile[require('node:util').promisify.custom] = (...args) => new Promise((resolve, reject) => {
  cp.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
});
require('node:module').syncBuiltinESMExports();
const setToolTip = electron.Tray.prototype.setToolTip;
const setContextMenu = electron.Tray.prototype.setContextMenu;
electron.Tray.prototype.setContextMenu = function (menu) { global.estraTest.menu = menu; return setContextMenu.call(this, menu); };
electron.Tray.prototype.setToolTip = function (...args) {
  if (!global.estraTest.trays.includes(this)) global.estraTest.trays.push(this);
  global.estraTest.tooltip = args[0];
  return setToolTip.apply(this, args);
};
const sessions = require('../desktop/gameSession.cjs');
const create = sessions.createGameSession;
sessions.createGameSession = options => create({ ...options, pollMs: 50, startupMs: 700, exitGraceMs: 200, detectionGraceMs: 200 });
require('../desktop/main.cjs');
