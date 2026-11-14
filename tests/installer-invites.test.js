import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectGameEnvironment, installFiveMBootstrap } from '../src/server/fivemBackend.js';
import { createSocialStore } from '../src/server/socialStore.js';
import { createApi } from '../src/server/api.js';

test('detectGameEnvironment detects GTA V from Steam Registry / CitizenFX.ini and custom FiveM path', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-detect-env-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const gtavDir = path.join(dir, 'Games', 'Grand Theft Auto V');
  const fivemDir = path.join(dir, 'CustomDrive', 'EstraFiveM', 'FiveM');
  await fs.mkdir(gtavDir, { recursive: true });
  await fs.mkdir(path.join(fivemDir, 'FiveM.app'), { recursive: true });
  await fs.writeFile(path.join(gtavDir, 'GTA5.exe'), 'MZ-gtav');
  await fs.writeFile(path.join(fivemDir, 'FiveM.exe'), 'MZ-fivem');
  await fs.writeFile(path.join(fivemDir, 'FiveM.app', 'CitizenFX.ini'), `[Game]\nIVPath=${gtavDir}\n`);

  // Via Registry mock
  const fromReg = await detectGameEnvironment(fivemDir, {}, {
    queryRegistry: async (key, val) => {
      if (key.includes('Steam App 271590') && val === 'InstallLocation') return gtavDir;
      return '';
    }
  });
  assert.equal(fromReg.success, true);
  assert.equal(fromReg.fivem.found, true);
  assert.equal(path.normalize(fromReg.fivem.root).toLowerCase(), path.normalize(fivemDir).toLowerCase());
  assert.equal(fromReg.gtav.found, true);
  assert.equal(fromReg.gtav.source, 'Steam Registry');

  // Via CitizenFX.ini fallback when registry is empty
  const fromIni = await detectGameEnvironment(fivemDir, {}, {
    queryRegistry: async () => ''
  });
  assert.equal(fromIni.gtav.found, true);
  assert.equal(fromIni.gtav.source, 'CitizenFX.ini');
});

test('installFiveMBootstrap validates targetDir, verifies PE header, and installs atomically', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-install-fivem-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    () => installFiveMBootstrap({ targetDir: 'relative\\FiveM' }),
    /พาธแบบเต็ม/
  );
  await assert.rejects(
    () => installFiveMBootstrap({ targetDir: 'C:\\Windows\\Temp\\FiveM' }),
    /โฟลเดอร์ระบบ/
  );

  const customTarget = path.join(dir, 'DriveD', 'EstraFiveM', 'FiveM');

  // Corrupt / non-MZ payload must be rejected before renaming
  await assert.rejects(
    () => installFiveMBootstrap(
      { targetDir: customTarget },
      {
        queryRegistry: async () => '',
        fetch: async () => new Response(Buffer.alloc(2048, 0x41), { status: 200 })
      }
    ),
    /ไม่ถูกต้อง/
  );

  // Valid > 1MB MZ binary succeeds and writes FiveM.exe atomically
  const fakePe = Buffer.alloc(1_100_000, 0);
  fakePe[0] = 0x4d;
  fakePe[1] = 0x5a;
  const ok = await installFiveMBootstrap(
    { targetDir: customTarget },
    {
      queryRegistry: async () => '',
      fetch: async () => new Response(fakePe, { status: 200 })
    }
  );
  assert.equal(ok.success, true);
  assert.equal(ok.alreadyInstalled, false);
  const exeStat = await fs.stat(path.join(customTarget, 'FiveM.exe'));
  assert.equal(exeStat.size, 1_100_000);

  // Second call detects alreadyInstalled without hitting fetch again
  let fetchCalled = false;
  const second = await installFiveMBootstrap(
    { targetDir: customTarget },
    {
      queryRegistry: async () => '',
      fetch: async () => {
        fetchCalled = true;
        throw new Error('should not fetch');
      }
    }
  );
  assert.equal(second.alreadyInstalled, true);
  assert.equal(fetchCalled, false);
});

test('socialStore and HTTP BFF handle game invites, response actions, validation, and rate limits', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-invites-'));
  const socialStore = createSocialStore({ dbPath: path.join(dir, 'social.db') });
  const middleware = createApi({ socialStore });
  const server = http.createServer(middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    socialStore.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/session`)).json();

  // Check /api/game-environment and /api/install-fivem validation via HTTP
  const envRes = await fetch(`${base}/api/game-environment`);
  assert.equal(envRes.status, 200);
  const envJson = await envRes.json();
  assert.equal(envJson.success, true);
  assert.ok(typeof envJson.suggestedInstallDir === 'string' && envJson.suggestedInstallDir.length > 0);

  const badInstall = await fetch(`${base}/api/install-fivem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
    body: JSON.stringify({ targetDir: 'C:\\Windows\\System32\\FiveM' })
  });
  assert.equal(badInstall.status, 400);

  // Register Alice & Bob over HTTP + make them friends
  const regA = await fetch(`${base}/api/social/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
    body: JSON.stringify({ username: 'alice_inv', password: 'password123', displayName: 'Alice' })
  });
  const cookieA = (regA.headers.get('set-cookie') || '').split(';')[0];
  const aliceData = await regA.json();

  const regB = await fetch(`${base}/api/social/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
    body: JSON.stringify({ username: 'bob_inv', password: 'password123', displayName: 'Bob' })
  });
  const cookieB = (regB.headers.get('set-cookie') || '').split(';')[0];
  const bobData = await regB.json();

  // Non-friend invite rejected (403)
  const nonFriendInv = await fetch(`${base}/api/social/game-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
    body: JSON.stringify({
      friendId: bobData.user.id,
      server: { id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120' }
    })
  });
  assert.equal(nonFriendInv.status, 403);

  // Add friend & accept
  await fetch(`${base}/api/social/friend-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
    body: JSON.stringify({ target: 'bob_inv' })
  });
  const bState1 = await (await fetch(`${base}/api/social/state`, { headers: { Cookie: cookieB } })).json();
  await fetch(`${base}/api/social/friend-respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieB },
    body: JSON.stringify({ requestId: bState1.incomingRequests[0].id, action: 'accept' })
  });

  // Demo account cannot receive invite
  await fetch(`${base}/api/social/demo-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
    body: '{}'
  });
  const demoInv = await fetch(`${base}/api/social/game-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
    body: JSON.stringify({
      friendId: 'demo-sacrig',
      server: { id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120' }
    })
  });
  assert.equal(demoInv.status, 400);

  // Valid invite Alice -> Bob
  const invRes = await fetch(`${base}/api/social/game-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
    body: JSON.stringify({
      friendId: bobData.user.id,
      server: { id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120' }
    })
  });
  assert.equal(invRes.status, 200);
  const invJson = await invRes.json();
  assert.equal(invJson.outgoingInvites.length, 1);

  const bState2 = await (await fetch(`${base}/api/social/state`, { headers: { Cookie: cookieB } })).json();
  assert.equal(bState2.incomingInvites.length, 1);
  assert.equal(bState2.incomingInvites[0].fromUser.displayName, 'Alice');
  assert.equal(bState2.incomingInvites[0].server.ip, '89.38.101.136:30120');

  // Bob accepts -> returns inviteServer and clears pending
  const acceptRes = await fetch(`${base}/api/social/game-invite-respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieB },
    body: JSON.stringify({ inviteId: bState2.incomingInvites[0].id, action: 'accept' })
  });
  assert.equal(acceptRes.status, 200);
  const acceptJson = await acceptRes.json();
  assert.equal(acceptJson.inviteServer.ip, '89.38.101.136:30120');
  assert.equal(acceptJson.incomingInvites.length, 0);

  // Alice sends another invite and cancels it, then hits BFF rate limit (max 20 in 10m; 2 sent above -> 18 more succeed, 21st returns 429)
  const cancelTarget = await (await fetch(`${base}/api/social/game-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
    body: JSON.stringify({
      friendId: bobData.user.id,
      server: { id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120' }
    })
  })).json();
  assert.equal(cancelTarget.outgoingInvites.length, 1);
  const cancelRes = await fetch(`${base}/api/social/game-invite-respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
    body: JSON.stringify({ inviteId: cancelTarget.outgoingInvites[0].id, action: 'cancel' })
  });
  assert.equal(cancelRes.status, 200);
  assert.equal((await cancelRes.json()).outgoingInvites.length, 0);

  // Already sent 3 (demo-sacrig 400 also hit rate limit! plus 2 valid + 1 cancel? wait nonFriendInv + demoInv + invRes + cancelTarget = 4 requests to /api/social/game-invite)
  let hit429 = false;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${base}/api/social/game-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookieA },
      body: JSON.stringify({
        friendId: bobData.user.id,
        server: { id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120' }
      })
    });
    if (r.status === 429) {
      hit429 = true;
      break;
    }
    assert.equal(r.status, 200);
  }
  assert.equal(hit429, true);
  assert.ok(aliceData.user.id);
});
