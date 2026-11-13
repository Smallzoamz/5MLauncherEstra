import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export const DISCORD_APPLICATION_ID = '1545873345596096734';

export function parseVdf(text) {
  if (text.length > 2 * 1024 * 1024) throw new Error('Steam profile file too large');
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}]|\/\/[^\r\n]*|[^\s{}"]+/g) || [];
  let index = 0;
  const value = token => token?.startsWith('"') ? token.slice(1, -1).replace(/\\(["\\])/g, '$1') : token;
  function object(depth = 0) {
    if (depth > 30) throw new Error('Invalid Steam profile');
    const result = Object.create(null);
    while (index < tokens.length) {
      const key = tokens[index++]; if (key.startsWith('//')) continue;
      if (key === '}') return result;
      const token = tokens[index++]; if (!token) throw new Error('Invalid Steam profile');
      result[value(key)] = token === '{' ? object(depth + 1) : value(token);
    }
    return result;
  }
  return object();
}
async function limitedFile(file, max = 2 * 1024 * 1024) {
  const handle = await fs.open(file, 'r');
  try { if ((await handle.stat()).size > max) throw new Error('Profile file too large'); return await handle.readFile(); }
  finally { await handle.close(); }
}
export async function readSteamIdentity(execute = run) {
  const options = { windowsHide: true, timeout: 3000, maxBuffer: 16384 };
  const [root, active] = await Promise.all([
    execute('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], options),
    execute('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], options)
  ]);
  const steamPath = root.stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
  const rawId = active.stdout.match(/ActiveUser\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i)?.[1];
  const accountId = Number(rawId);
  if (!steamPath || !path.isAbsolute(steamPath) || !Number.isSafeInteger(accountId) || accountId <= 0 || accountId > 0xffffffff) throw new Error('Steam ยังไม่ได้ล็อกอินบัญชี');
  return { steamPath, steamId: String(76561197960265728n + BigInt(accountId)) };
}
export async function getSteamProfile({ identity = readSteamIdentity, readFile = limitedFile } = {}) {
  const { steamPath, steamId } = await identity();
  if (!/^765\d{14}$/.test(steamId)) throw new Error('อ่านบัญชี Steam ปัจจุบันไม่ได้');
  const users = parseVdf((await readFile(path.join(steamPath, 'config/loginusers.vdf'))).toString('utf8')).users;
  const displayName = users?.[steamId]?.PersonaName;
  if (typeof displayName !== 'string' || !displayName.trim()) throw new Error('ไม่พบชื่อบัญชี Steam ที่ใช้งานอยู่');
  let avatarUrl = null;
  // Only the avatar matching ActiveUser, never another remembered login.
  for (const extension of ['png', 'jpg']) {
    try {
      const bytes = await readFile(path.join(steamPath, 'config/avatarcache', `${steamId}.${extension}`), 1024 * 1024);
      if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) avatarUrl = `data:image/png;base64,${bytes.toString('base64')}`;
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) avatarUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      if (avatarUrl) break;
    } catch { /* The UI uses initials when Steam has no cached avatar. */ }
  }
  // Re-check the active account after IO to avoid displaying a previous login.
  if ((await identity()).steamId !== steamId) throw new Error('Steam กำลังเปลี่ยนบัญชี กรุณารอสักครู่');
  return { id: steamId, displayName: displayName.slice(0, 100), avatarUrl, source: 'Steam ActiveUser' };
}
export function discordProfile(user) {
  if (!user || !/^\d{17,20}$/.test(user.id) || typeof user.username !== 'string') throw new Error('Discord ยังไม่ได้ล็อกอินบัญชี');
  const avatar = typeof user.avatar === 'string' && /^(?:a_)?[a-f0-9]{32}$/.test(user.avatar) ? user.avatar : null;
  const defaultIndex = /^\d{4}$/.test(user.discriminator || '') && user.discriminator !== '0000' ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return { id: user.id, displayName: (user.global_name || user.username).slice(0, 100), username: user.username.slice(0, 100),
    avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`, source: 'Discord RPC' };
}
export function readDiscordPipe(pipe, { connect = net.createConnection, timeout = 1200 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(pipe); let buffer = Buffer.alloc(0), settled = false;
    const finish = (error, user) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(user); };
    const timer = setTimeout(() => finish(new Error('Discord RPC timed out')), timeout);
    const frame = (opcode, payload) => { const header = Buffer.alloc(8); header.writeUInt32LE(opcode); header.writeUInt32LE(payload.length, 4); socket.write(Buffer.concat([header, payload])); };
    socket.once('connect', () => frame(0, Buffer.from(JSON.stringify({ v: 1, client_id: DISCORD_APPLICATION_ID }))));
    socket.on('error', error => finish(error)); socket.once('end', () => finish(new Error('Discord disconnected')));
    socket.on('data', chunk => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 262144) return finish(new Error('Discord RPC frame too large'));
      while (buffer.length >= 8) {
        const opcode = buffer.readUInt32LE(0), length = buffer.readUInt32LE(4);
        if (length > 262136) return finish(new Error('Discord RPC frame too large'));
        if (buffer.length < length + 8) return;
        const payload = buffer.subarray(8, 8 + length); buffer = buffer.subarray(8 + length);
        if (opcode === 3) { frame(4, payload); continue; }
        try {
          const message = JSON.parse(payload.toString('utf8'));
          if (opcode === 2 || message.evt === 'ERROR') return finish(new Error('Discord ไม่อนุญาตการอ่านโปรไฟล์ผ่าน RPC'));
          if (opcode === 1 && message.evt === 'READY') return finish(null, discordProfile(message.data?.user));
        } catch { return finish(new Error('ข้อมูลโปรไฟล์ Discord ไม่ถูกต้อง')); }
      }
    });
  });
}
export async function getDiscordProfile() {
  const deadline = Date.now() + 2500;
  for (let i = 0; i < 10 && Date.now() < deadline; i++) {
    try { return await readDiscordPipe(`\\\\?\\pipe\\discord-ipc-${i}`, { timeout: Math.min(1200, deadline - Date.now()) }); }
    catch { /* Try another installed Discord channel, with a total deadline. */ }
  }
  throw new Error('เปิด Discord แล้ว แต่ยังอ่านบัญชีผ่าน RPC ไม่ได้');
}
