const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
(async () => {
  assert.ok(process.env.LAUNCHER_PACKAGED_EXE, 'packaged executable required');
  const root = await fs.mkdtemp(path.resolve('tests/artifacts/packaged-shell-probe-'));
  const exe = path.join(root, 'FiveM.exe');
  await run(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/reference:System.Management.dll', '/out:' + exe, path.resolve('tests/fixtures/shell-probe.cs')], { windowsHide: true });
  const env = { ...process.env, LAUNCHER_TEST_USER_DATA: path.resolve('tests/artifacts/packaged-shell-profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: process.env.LAUNCHER_PACKAGED_EXE, args: [], env });
  try {
    await app.firstWindow();
    const evidence = [];
    for (const args of [['-b3095', '-pure_2', 'fivem://connect/127.0.0.1:30120'], ['-cl2', '-b3258', '-pure_0', 'fivem://connect/cfx.re/join/abcdef']]) {
      await fs.rm(path.join(root, 'probe.txt'), { force: true });
      const appPath = await app.evaluate(async ({ app }, { root, exe, args }) => {
        const { launchThroughExplorer } = process.mainModule.require(app.getAppPath() + '/src/server/windowsShell.js');
        await launchThroughExplorer({ root, exe }, args);
        return app.getAppPath();
      }, { root, exe, args });
      assert.ok(appPath.endsWith('.asar'));
      let result; const deadline = Date.now() + 10000;
      while (Date.now() < deadline) { try { result = (await fs.readFile(path.join(root, 'probe.txt'), 'utf8')).trim().split(/\r?\n/); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
      assert.ok(result); assert.equal(result[0].toLowerCase(), 'explorer'); assert.equal(result[1], '0'); assert.equal(result[2], args.join('|'));
      evidence.push({ fromAsar: true, parent: result[0], console: false, args, actualFiveMExecuted: false });
    }
    const version = await app.evaluate(({ app }) => app.getVersion());
    await fs.writeFile(`tests/artifacts/packaged-shell-${version}.json`, JSON.stringify(evidence, null, 2)); console.log(evidence);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });
