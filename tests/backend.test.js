import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { parseTarget } from '../src/shared/target.js';
import { queryLiveServer, resolveInstallation, buildLaunchArgs, executeRealLaunch, executeRealCleanCache } from '../src/server/fivemBackend.js';
import { createApi } from '../src/server/api.js';

test('target normalization and injection rejection', () => {
  assert.equal(parseTarget(' 127.0.0.1 ').address, '127.0.0.1:30120');
  assert.equal(parseTarget('Example.COM:65535').address, 'example.com:65535');
  assert.equal(parseTarget('https://cfx.re/join/Ab1234/').address, 'cfx.re/join/ab1234');
  for (const bad of ['', null, '1.2.3.999', '127.1', '012.1.1.1', 'host:0', 'host:65536', 'host:abc', 'host/path', 'http://host', 'host&calc', 'host";quit', 'host\n+quit', 'user@host', 'file:///C:/test', 'a..b', '-cl2']) assert.throws(() => parseTarget(bad), String(bad));
});
test('query uses actual zero counts and no invented build/pure/count', async () => {
  const result = await queryLiveServer('example.com', async url => url.endsWith('dynamic.json') ? { clients: 0 } : {});
  assert.equal(result.online, true); assert.equal(result.clients, 0);
  assert.equal(result.maxClients, null); assert.equal(result.gameBuild, null); assert.equal(result.lockPure, null);
});
test('query failure never claims online', async () => {
  const result = await queryLiveServer('example.com', async () => { throw new Error('timeout'); });
  assert.equal(result.online, false); assert.equal(result.clients, null); assert.match(result.error, /timeout/);
});
test('join code query goes to Cfx endpoint', async () => {
  const result = await queryLiveServer('cfx.re/join/abcdef', async url => {
    assert.equal(url, 'https://servers-frontend.fivem.net/api/servers/single/abcdef');
    return { Data: { clients: 7, svMaxclients: 32, vars: { sv_enforceGameBuild: '3095', sv_pureLevel: '0' } } };
  });
  assert.equal(result.clients, 7); assert.equal(result.maxClients, 32); assert.equal(result.lockPure, 0);
});
test('malformed server response is not online', async () => {
  assert.equal((await queryLiveServer('host', async () => ({}))).online, false);
});
test('launch arguments preserve single connect and CL2 with explicit build/pure, without INI changes', () => {
  assert.deepEqual(buildLaunchArgs({ ip: 'cfx.re/join/abcdef', cl2: true, gameBuild: '3095', lockPure: 2 }), ['-cl2', '-b3095', '-pure_2', 'fivem://connect/cfx.re/join/abcdef']);
  assert.deepEqual(buildLaunchArgs({ ip: '127.0.0.1', cl2: false, gameBuild: '3258', lockPure: 0 }), ['-b3258', '-pure_0', 'fivem://connect/127.0.0.1:30120']);
  assert.throws(() => buildLaunchArgs({ ip: 'x', cl2: 'true' }));
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-test-'));
  t.after(async () => {
    // Only the exact directory created by mkdtemp, checked before recursive removal.
    assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('launcher-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'FiveM.exe'), 'TEST FIXTURE - NEVER EXECUTE');
  const data = path.join(root, 'FiveM.app', 'data');
  for (const name of ['server-cache', 'server-cache-priv', 'cache/subprocess', 'game-storage', 'cache/game']) {
    await fs.mkdir(path.join(data, name), { recursive: true }); await fs.writeFile(path.join(data, name, 'keep.txt'), name);
  }
  await fs.writeFile(path.join(root, 'FiveM.app', 'CitizenFX.ini'), '[Game]\r\nCustom=keep\r\n');
  return { root, data, fivemPath: root };
}
test('custom installation root, exe, and app path resolve', async t => {
  const f = await fixture(t);
  for (const p of [f.root, path.join(f.root, 'FiveM.exe'), path.join(f.root, 'FiveM.app')]) assert.equal((await resolveInstallation(p)).root, f.root);
  await assert.rejects(resolveInstallation('relative'), /พาธแบบเต็ม/);
  await assert.rejects(resolveInstallation(path.join(f.root, 'missing')), /ไม่พบ FiveM.exe/);
});
test('Explorer dispatch success/failure awaited exactly once; real game never executed', async t => {
  const f = await fixture(t); let calls = 0;
  const launchThroughExplorer = async (installation, args) => {
    calls++; assert.equal(installation.exe, path.join(f.root, 'FiveM.exe'));
    assert.deepEqual(args, ['-b3095', '-pure_0', 'fivem://connect/127.0.0.1:30120']);
  };
  const deps = { launchThroughExplorer, platform: 'win32', getProcessNames: async () => [], queryLiveServer: async () => ({ online: true, gameBuild: '3095', lockPure: 0, requirementsSource: 'Direct HTTP' }) };
  assert.equal((await executeRealLaunch({ ip: '127.0.0.1', fivemPath: f.root }, deps)).success, true);
  assert.equal(calls, 1);
  await assert.rejects(executeRealLaunch({ ip: '127.0.0.1', fivemPath: f.root }, { ...deps, launchThroughExplorer: async () => { throw new Error('Shell failed'); } }), /Shell failed/);
  assert.equal(await fs.readFile(path.join(f.root, 'FiveM.app', 'CitizenFX.ini'), 'utf8'), '[Game]\r\nCustom=keep\r\n');
});
test('cache allowlist preserves game storage and game files; repeat works', async t => {
  const f = await fixture(t);
  assert.equal((await executeRealCleanCache(f, { getProcessNames: async () => [] })).success, true);
  for (const p of ['game-storage/keep.txt', 'cache/game/keep.txt']) assert.ok(await fs.readFile(path.join(f.data, p)));
  await assert.rejects(fs.access(path.join(f.data, 'server-cache')));
  assert.equal((await executeRealCleanCache(f, { getProcessNames: async () => [] })).success, true);
});
test('running game and process detection error prevent cache deletion', async t => {
  const f = await fixture(t);
  await assert.rejects(executeRealCleanCache(f, { getProcessNames: async () => ['FiveM_b3095_GTAProcess.exe'] }), /ปิด FiveM/);
  await assert.rejects(executeRealCleanCache(f, { getProcessNames: async () => { throw new Error('tasklist failed'); } }), /tasklist failed/);
  assert.ok(await fs.readFile(path.join(f.data, 'server-cache/keep.txt')));
});
test('nested junction blocks all deletion and preserves outside target', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'safe');
  await fs.symlink(outside, path.join(f.data, 'server-cache-priv', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(executeRealCleanCache(f, { getProcessNames: async () => [] }), /junction/);
  assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'safe');
  assert.ok(await fs.readFile(path.join(f.data, 'server-cache/keep.txt')));
});
test('HTTP authorization, origin, host, body, routes, and mutation serialization', async t => {
  let launches = 0, release;
  const middleware = createApi({
    executeRealLaunch: async () => { launches++; return { success: true }; },
    executeRealCleanCache: async () => { await new Promise(resolve => { release = resolve; }); return { success: true }; }
  });
  const server = http.createServer(middleware); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const { token } = await (await fetch(base + '/api/session')).json();
  const post = (url, headers = {}, body = '{}') => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post('/api/launch-fivem')).status, 403);
  const valid = { 'X-Launcher-Token': token };
  assert.equal((await post('/api/launch-fivem', { ...valid, Origin: 'https://evil.example' })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/session', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await fetch(base + '/api/launch-fivem')).status, 405);
  assert.equal((await fetch(base + '/api/missing')).status, 404);
  assert.equal((await post('/api/launch-fivem', valid, '{')).status, 400);
  assert.equal((await post('/api/launch-fivem', valid, '[]')).status, 400);
  assert.equal((await post('/api/launch-fivem', valid, JSON.stringify({ value: 'x'.repeat(9000) }))).status, 413);
  assert.equal((await post('/api/launch-fivem', valid)).status, 200);
  assert.equal(launches, 1);
  const pending = post('/api/clean-cache', valid);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await post('/api/launch-fivem', valid)).status, 409);
  release(); assert.equal((await pending).status, 200);
  assert.equal(launches, 1);
});


