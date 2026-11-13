import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSteamProfile, getDiscordProfile } from './accountProfiles.js';
const run = promisify(execFile);
export async function getProcessNames() {
  if (process.platform !== 'win32') throw new Error('การตรวจโปรแกรมรองรับ Windows เท่านั้น');
  const { stdout } = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
  const names = stdout.split(/\r?\n/).map(line => line.match(/^"([^"]+)"/)?.[1]?.toLowerCase()).filter(Boolean);
  if (!names.length) throw new Error('อ่านรายการ process ของ Windows ไม่ได้');
  return names;
}
export function isFiveMProcess(name) { return /^fivem(?:_.*)?\.exe$/i.test(name); }
export function isFiveMSessionProcess(name) { return /^fivem(?:_b\d+)?(?:_GTAProcess|_GameProcess)?\.exe$/i.test(name); }
export async function getFiveMSessions() {
  const { stdout } = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
  const rows = stdout.split(/\r?\n/).map(line => line.match(/^"([^"]+)","(\d+)"/)).filter(Boolean);
  if (!rows.length) throw new Error('อ่านรายการ process ของ Windows ไม่ได้');
  return rows.filter(row => isFiveMSessionProcess(row[1])).map(row => Number(row[2]));
}
export async function getSystemPresence(readNames = getProcessNames, profiles = {}) {
  try {
    const names = (await readNames()).map(name => name.toLowerCase());
    const presence = {
      steam: { running: names.includes('steam.exe'), user: null, error: null },
      discord: { running: names.some(n => /^discord(?:canary|ptb)?\.exe$/.test(n)), user: null, error: null },
      fivem: { running: names.some(isFiveMProcess), error: null },
      checkedAt: new Date().toISOString()
    };
    // Unit callers can supply profile readers; process-only fixtures do no IO.
    const readers = { steam: profiles.steam || (readNames === getProcessNames ? getSteamProfile : null), discord: profiles.discord || (readNames === getProcessNames ? getDiscordProfile : null) };
    await Promise.all(['steam', 'discord'].map(async key => {
      if (!presence[key].running || !readers[key]) return;
      try { presence[key].user = await readers[key](); }
      catch (error) { presence[key].profileError = error.message; }
    }));
    return presence;
  } catch (error) {
    return { steam: { running: null, user: null, error: error.message }, discord: { running: null, user: null, error: error.message }, fivem: { running: null, error: error.message } };
  }
}

