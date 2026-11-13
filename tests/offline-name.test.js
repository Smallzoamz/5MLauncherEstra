import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { queryLiveServer, executeRealLaunch } from '../src/server/fivemBackend.js';
import { validatePlayerName } from '../src/shared/playerName.js';
import { applyPlayerName, NICKNAME_KEY, NICKNAME_ORIGIN } from '../src/server/playerName.js';
import { ClassicLevel } from 'classic-level';
test('live endpoint goes Online -> Offline after closing, without stale counts', async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ clients: 0, sv_maxclients: 100 })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const address = '127.0.0.1:' + server.address().port;
  assert.equal((await queryLiveServer(address)).status, 'Online');
  await new Promise(r => { server.closeAllConnections(); server.close(r); });
  const offline = await queryLiveServer(address); assert.equal(offline.status, 'Offline'); assert.equal(offline.clients, null);
  const invalid = await queryLiveServer('example.com', async () => ({})); assert.equal(invalid.status, 'Unknown');
  assert.equal((await queryLiveServer('cfx.re/join/abcdef', async () => { throw Object.assign(Error('HTTP 404'), { httpStatus: 404 }); })).status, 'Offline');
});
test('Name is validated and applied before dispatch, including CL2 exclusion while a game is running', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-name-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('estra-name-')); await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, 'FiveM.exe'), 'fixture');
  const order = []; const server = { fivemPath: root, ip: 'example.com', inGameName: 'Sora Kitagawa' };
  const deps = { platform: 'win32', getProcessNames: async () => [], queryLiveServer: async () => ({ online: true, gameBuild: '3095', lockPure: 0, requirementsSource: 'Direct HTTP' }), applyPlayerName: async (installation, name) => { assert.equal(name, server.inGameName); order.push('name'); }, launchThroughExplorer: async (_, args) => { order.push('launch'); assert.ok(!args.some(a => a.includes('Sora'))); } };
  await executeRealLaunch(server, deps); assert.deepEqual(order, ['name', 'launch']);
  await assert.rejects(executeRealLaunch({ ...server, cl2: true }, { ...deps, getProcessNames: async () => ['FiveM.exe'] }), /ปิด FiveM/);
  await assert.rejects(executeRealLaunch(server, { ...deps, applyPlayerName: async () => { throw Error('locked'); } }), /locked/);
  assert.deepEqual(order, ['name', 'launch']);
  for (const bad of ['a\nquit', 'a'.repeat(101), {}, '\x00']) assert.throws(() => validatePlayerName(bad));
  assert.equal(validatePlayerName('ทดสอบ 🔮'), 'ทดสอบ 🔮');
});
test('applyPlayerName supports modern Default profile, fresh install without prior nickOverride, and legacy fallback', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-profile-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true }); });
  const seedDb = async dbPath => {
    const db = new ClassicLevel(dbPath, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
    await db.batch([
      { type: 'put', key: Buffer.from('VERSION'), value: Buffer.from('1') },
      { type: 'put', key: Buffer.from('META:' + NICKNAME_ORIGIN), value: Buffer.from([8, 0, 16, 32]) }
    ]);
    await db.close();
  };
  const installation = { app: path.join(root, 'FiveM.app'), data: path.join(root, 'FiveM.app', 'data') };
  await assert.rejects(applyPlayerName(installation, 'Sora'), /กรุณาเปิด FiveM หนึ่งครั้ง/);

  const legacyPath = path.join(installation.data, 'nui-storage', 'Local Storage', 'leveldb');
  await seedDb(legacyPath);
  assert.equal((await applyPlayerName(installation, 'LegacyName')).changed, true);

  const defaultPath = path.join(installation.data, 'nui-storage', 'Default', 'Local Storage', 'leveldb');
  await seedDb(defaultPath);
  assert.equal((await applyPlayerName(installation, 'Modern · ทดสอบ')).changed, true);

  const defaultDb = new ClassicLevel(defaultPath, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
  const stored = await defaultDb.get(NICKNAME_KEY);
  await defaultDb.close();
  assert.equal(stored[0], 0);
  assert.equal(stored.subarray(1).toString('utf16le'), 'Modern · ทดสอบ');

  const legacyDb = new ClassicLevel(legacyPath, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
  const legacyStored = await legacyDb.get(NICKNAME_KEY);
  await legacyDb.close();
  assert.equal(legacyStored.subarray(1).toString('latin1'), 'LegacyName');
});
