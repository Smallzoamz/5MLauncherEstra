import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queryLiveServer, executeRealLaunch, buildLaunchArgs } from '../src/server/fivemBackend.js';

const live = (gameBuild = '3095', lockPure = 1) => ({ online: true, gameBuild, lockPure, requirementsSource: 'Direct HTTP' });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxXcAAAAASUVORK5CYII=';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-requirements-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('estra-requirements-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'FiveM.exe'), 'TEST FIXTURE - NEVER EXECUTE');
  return { ip: 'example.com:30120', fivemPath: root, gameBuild: '2060', lockPure: 2 };
}

test('each dispatch uses fresh server requirements instead of saved/browser values, including pure 0 and CL2', async t => {
  const server = await fixture(t), calls = [], args = [];
  let current = live();
  const deps = { platform: 'win32', getProcessNames: async () => [],
    queryLiveServer: async target => { calls.push(target); return current; },
    launchThroughExplorer: async (_, value) => args.push(value) };
  const first = await executeRealLaunch(server, deps);
  current = live('3258', 0);
  const second = await executeRealLaunch({ ...server, cl2: true }, deps);
  assert.deepEqual(calls, [server.ip, server.ip]);
  assert.deepEqual(args, [
    ['-b3095', '-pure_1', 'fivem://connect/example.com:30120'],
    ['-cl2', '-b3258', '-pure_0', 'fivem://connect/example.com:30120']
  ]);
  assert.equal(first.serverInfo.gameBuild, '3095');
  assert.equal(second.serverInfo.lockPure, 0);
});

test('unavailable, incomplete, invalid or listing-only requirements prevent dispatch and Name writes', async t => {
  const server = await fixture(t); let writes = 0, dispatches = 0;
  for (const current of [{ online: false, error: 'offline' }, live(null), live('3095', null), live('bad'), live('3095', 3), { ...live(), requirementsSource: null }]) {
    await assert.rejects(executeRealLaunch({ ...server, inGameName: 'Test' }, {
      platform: 'win32', getProcessNames: async () => [], queryLiveServer: async () => current,
      applyPlayerName: async () => writes++, launchThroughExplorer: async () => dispatches++
    }), /เซิร์ฟเวอร์|Game Build|Pure Mode/);
  }
  assert.equal(writes, 0); assert.equal(dispatches, 0);
});

test('FiveM starting while the server query is pending prevents the eventual normal dispatch', async t => {
  const server = await fixture(t); let reads = 0, dispatches = 0;
  await assert.rejects(executeRealLaunch(server, { platform: 'win32',
    getProcessNames: async () => ++reads === 1 ? [] : ['FiveM.exe'],
    queryLiveServer: async () => live(), launchThroughExplorer: async () => dispatches++
  }), error => error.status === 409);
  assert.equal(dispatches, 0);
});

test('Cfx queries refresh requirements from the advertised endpoint even when all listing media exists', async () => {
  const calls = [];
  const result = await queryLiveServer('cfx.re/join/abcdef', async url => {
    calls.push(url);
    if (url.includes('/single/')) return { Data: { clients: 1, icon: png, connectEndPoints: ['example.com:30120'],
      vars: { sv_enforceGameBuild: '2060', sv_pureLevel: '2', banner_detail: 'https://cdn.example/city.png' } } };
    assert.equal(url, 'http://example.com:30120/info.json');
    return { vars: { sv_enforceGameBuild: '3258', sv_pureLevel: '0' } };
  });
  assert.equal(calls.length, 2);
  assert.equal(result.gameBuild, '3258'); assert.equal(result.lockPure, 0);
  assert.equal(result.requirementsSource, 'Direct HTTP');
  assert.equal(result.logoUrl, 'data:image/png;base64,' + png);
  assert.equal(result.bannerUrl, 'https://cdn.example/city.png');
});

test('a live endpoint omitting requirements clears stale listing values; failed endpoints remain unverified', async () => {
  for (const fails of [false, true]) {
    const result = await queryLiveServer('cfx.re/join/abcdef', async url => {
      if (url.includes('/single/')) return { Data: { clients: 1, connectEndPoints: ['example.com:30120'], vars: { sv_enforceGameBuild: '2060', sv_pureLevel: '2' } } };
      if (fails) throw Error('unreachable');
      return { vars: {} };
    });
    assert.equal(result.online, true);
    assert.equal(result.requirementsSource, fails ? null : 'Direct HTTP');
    if (!fails) { assert.equal(result.gameBuild, null); assert.equal(result.lockPure, null); }
  }
});

test('build and pure flags accept only complete validated requirements', () => {
  for (const requirements of [{}, { gameBuild: '3095' }, { gameBuild: '3095 & calc', lockPure: 0 }, { gameBuild: '3095', lockPure: '0 -cl2' }]) {
    assert.throws(() => buildLaunchArgs({ ip: 'example.com', ...requirements }), /Game Build|Pure Mode/);
  }
});

test('real HTTP launch query reads changed requirements on each attempt and bypasses caches', async t => {
  const server = await fixture(t), args = [], headers = [];
  let vars = { sv_enforceGameBuild: '3095', sv_pureLevel: '2' };
  const endpoint = http.createServer((req, res) => {
    if (req.url === '/info.json') headers.push(req.headers['cache-control']);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/info.json' ? { vars } : { clients: 0 }));
  });
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { endpoint.closeAllConnections(); endpoint.close(resolve); }));
  const target = { ...server, ip: `127.0.0.1:${endpoint.address().port}` };
  const deps = { platform: 'win32', getProcessNames: async () => [], launchThroughExplorer: async (_, value) => args.push(value) };
  await executeRealLaunch(target, deps);
  vars = { sv_enforceGameBuild: '3258', sv_pureLevel: '0' };
  const result = await executeRealLaunch(target, deps);
  assert.equal(result.serverInfo.gameBuild, '3258'); assert.equal(result.serverInfo.lockPure, 0);
  assert.deepEqual(args.map(value => value.slice(0, 2)), [['-b3095', '-pure_2'], ['-b3258', '-pure_0']]);
  assert.equal(headers.length, 2); assert.ok(headers.every(value => value.includes('no-cache')));
  vars = {};
  await assert.rejects(executeRealLaunch(target, deps), /Game Build/);
  assert.equal(args.length, 2);
});
