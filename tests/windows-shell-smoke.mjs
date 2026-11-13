import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchThroughExplorer } from '../src/server/windowsShell.js';
const run = promisify(execFile);
// A harmless, newly compiled WinExe probe, never the user's installed FiveM.
const root = await fs.mkdtemp(path.resolve("tests/artifacts/shell probe & city's -"));
const exe = path.join(root, 'FiveM.exe');
await run(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/reference:System.Management.dll', '/out:' + exe, path.resolve('tests/fixtures/shell-probe.cs')], { windowsHide: true });
for (const args of [['-b3095', '-pure_1', 'fivem://connect/127.0.0.1:30120'], ['-cl2', '-b3258', '-pure_0', 'fivem://connect/cfx.re/join/abcdef']]) {
  const output = path.join(root, 'probe.txt');
  await fs.rm(output, { force: true });
  await launchThroughExplorer({ exe, root }, args);
  let evidence;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { evidence = (await fs.readFile(output, 'utf8')).trim().split(/\r?\n/); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(evidence, 'Windows must actually launch the probe');
  assert.equal(evidence[0].toLowerCase(), 'explorer');
  assert.equal(evidence[1], '0', 'game must not inherit a console');
  assert.equal(evidence[2], args.join('|'));
  console.log(JSON.stringify({ parent: evidence[0], console: evidence[1], args }));
}
await fs.rm(path.join(root, 'probe.txt'), { force: true });
for (const invalid of ['-pure_3', '-b3095 -pure_2', '-pure_0;calc']) {
  await assert.rejects(launchThroughExplorer({ exe, root }, [invalid, 'fivem://connect/127.0.0.1:30120']), /Explorer/);
}
await assert.rejects(fs.access(path.join(root, 'probe.txt')));
console.log('Invalid build/pure arguments rejected before any probe dispatch');
