import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { getSteamProfile, discordProfile, readDiscordPipe, DISCORD_APPLICATION_ID } from '../src/server/accountProfiles.js';
import { getSystemPresence } from '../src/server/systemPresence.js';
const id = '76561199557563759';
test('Steam chooses only ActiveUser, loads matching avatar and drops account switches', async () => {
  const paths = [];
  const readFile = async file => { paths.push(file); return file.endsWith('.vdf') ? Buffer.from(`"users" { "${id}" { "PersonaName" "Current" } "76561198364679147" { "PersonaName" "Old" "MostRecent" "1" } }`) : Buffer.from([137,80,78,71,13,10,26,10]); };
  const identity = async () => ({ steamPath: 'C:/Steam', steamId: id });
  const user = await getSteamProfile({ identity, readFile });
  assert.equal(user.displayName, 'Current'); assert.ok(user.avatarUrl.startsWith('data:image/png'));
  assert.ok(paths.every(p => !p.includes('76561198364679147')));
  let calls = 0;
  await assert.rejects(getSteamProfile({ identity: async () => ({ steamPath: 'C:/Steam', steamId: ++calls === 1 ? id : '76561198364679147' }), readFile }), /เปลี่ยนบัญชี/);
});
test('Discord avatar URLs are restricted to Discord CDN and valid IDs/hash', () => {
  const user = discordProfile({ id: '956866340474478642', username: 'test', global_name: 'Display', avatar: 'a'.repeat(32) });
  assert.equal(user.displayName, 'Display'); assert.ok(user.avatarUrl.startsWith('https://cdn.discordapp.com/avatars/'));
  assert.ok(discordProfile({ id: user.id, username: 'test', avatar: 'https://evil.example' }).avatarUrl.includes('/embed/avatars/'));
  assert.throws(() => discordProfile({ id: '../', username: 'x' }));
});
test('Discord IPC handles fragmented READY frames without authenticating or sending user tokens', async () => {
  const socket = new EventEmitter(); const sent = []; let destroyed = false;
  socket.write = b => sent.push(b); socket.destroy = () => { destroyed = true; };
  const promise = readDiscordPipe('fixture', { connect: () => socket, timeout: 1000 });
  socket.emit('connect');
  assert.deepEqual(JSON.parse(sent[0].subarray(8)), { v: 1, client_id: DISCORD_APPLICATION_ID });
  const body = Buffer.from(JSON.stringify({ evt: 'READY', data: { user: { id: '956866340474478642', username: 'Live' } } }));
  const header = Buffer.alloc(8); header.writeUInt32LE(1); header.writeUInt32LE(body.length, 4);
  const frame = Buffer.concat([header, body]); socket.emit('data', frame.subarray(0, 6)); socket.emit('data', frame.subarray(6));
  assert.equal((await promise).displayName, 'Live'); assert.equal(destroyed, true); assert.equal(sent.length, 1);
});
test('Discord rejects oversized frames and times out without leaking a socket', async () => {
  for (const oversized of [true, false]) {
    const socket = new EventEmitter(); socket.write = () => {}; let closed = false; socket.destroy = () => { closed = true; };
    const pending = readDiscordPipe('fixture', { connect: () => socket, timeout: 10 });
    if (oversized) { const h = Buffer.alloc(8); h.writeUInt32LE(1); h.writeUInt32LE(999999, 4); socket.emit('data', h); }
    await assert.rejects(pending); assert.equal(closed, true);
  }
});
test('profile errors do not change process status; closed apps never return a cached account', async () => {
  const p = await getSystemPresence(async () => ['steam.exe', 'discord.exe'], { steam: async () => { throw Error('signed out'); }, discord: async () => ({ displayName: 'Current' }) });
  assert.equal(p.steam.running, true); assert.equal(p.steam.user, null); assert.equal(p.discord.user.displayName, 'Current');
  const q = await getSystemPresence(async () => ['explorer.exe'], { steam: async () => { throw Error('must not call'); }, discord: async () => { throw Error('must not call'); } });
  assert.equal(q.steam.running, false); assert.equal(q.discord.user, null);
});
