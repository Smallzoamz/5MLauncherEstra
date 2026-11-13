import { launchThroughExplorer } from './windowsShell.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTarget } from '../shared/target.js';
import { getProcessNames, isFiveMProcess } from './systemPresence.js';
import { serverBanners } from './serverBanners.js';
import { bannerImageUrl } from '../shared/serverMedia.js';
import { validatePlayerName } from '../shared/playerName.js';
import { applyPlayerName } from './playerName.js';

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4500), redirect: 'error', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { httpStatus: response.status });
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('ข้อมูลเซิร์ฟเวอร์มีขนาดเกินกำหนด');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const count = value => value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function serverIconDataUrl(value) {
  if (typeof value !== 'string' || value.length > 350000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024) return null;
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

export async function queryLiveServer(input, request = fetchJson, { includeMedia = true } = {}) {
  const target = parseTarget(input);
  const start = Date.now();
  try {
    let dynamic, info, requirementsInfo = null;
    if (target.kind === 'join') {
      const response = await request(`https://servers-frontend.fivem.net/api/servers/single/${target.code}`);
      const data = response.Data;
      if (!data || count(data.clients) === null) throw new Error('ไม่พบข้อมูล Cfx.re ของเซิร์ฟเวอร์นี้');
      dynamic = { ...data, sv_maxclients: data.svMaxclients };
      info = data;
      // Listings can lag behind the server. Always read live requirements, even
      // when listing media is complete. Ask only advertised FiveM endpoints.
      for (const endpoint of (Array.isArray(data.connectEndPoints) ? data.connectEndPoints.slice(0, 2) : [])) {
        try {
          const direct = parseTarget(endpoint);
          if (direct.kind !== 'direct') continue;
          const details = await request(`http://${direct.address}/info.json`);
          if (!details || typeof details !== 'object' || Array.isArray(details)) continue;
          requirementsInfo ??= details;
          const icon = serverIconDataUrl(details.icon) ? details.icon : info.icon;
          const vars = { ...info.vars,
            banner_detail: bannerImageUrl(info.vars?.banner_detail) || details.vars?.banner_detail,
            banner_connecting: bannerImageUrl(info.vars?.banner_connecting) || details.vars?.banner_connecting };
          info = { ...info, icon, vars };
          if (!includeMedia || (serverIconDataUrl(icon) && (bannerImageUrl(vars.banner_detail) || bannerImageUrl(vars.banner_connecting)))) break;
        } catch { /* Listing-only requirements remain unverified for launch. */ }
      }
    } else {
      [dynamic, info] = await Promise.all([
        request(`http://${target.address}/dynamic.json`),
        request(`http://${target.address}/info.json`).catch(() => null)
      ]);
      if (!dynamic || count(dynamic.clients) === null) throw new Error('ปลายทางไม่ได้ส่งสถานะ FiveM ที่ถูกต้อง');
      if (info && typeof info === 'object' && !Array.isArray(info)) requirementsInfo = info;
      info ||= {};
    }
    const vars = info.vars || {};
    // A responding endpoint with missing values must clear stale listing data.
    const requirements = (requirementsInfo || info).vars || {};
    const banners = includeMedia ? await serverBanners(vars) : {};
    return { online: true, status: 'Online', ip: target.address, clients: count(dynamic.clients), maxClients: count(dynamic.sv_maxclients),
      hostname: String(dynamic.hostname || vars.sv_projectName || target.address).slice(0, 200),
      gameBuild: /^[1-9]\d{3,4}$/.test(String(requirements.sv_enforceGameBuild)) ? String(requirements.sv_enforceGameBuild) : null,
      lockPure: /^[012]$/.test(String(requirements.sv_pureLevel)) ? Number(requirements.sv_pureLevel) : null,
      requirementsSource: requirementsInfo ? 'Direct HTTP' : null,
      logoUrl: serverIconDataUrl(info.icon), iconSource: serverIconDataUrl(info.icon) ? 'server-icon-v1' : null, ...banners, ping: Date.now() - start,
      checkedAt: new Date().toISOString(), source: target.kind === 'join' ? 'Cfx.re listing' : 'Direct HTTP' };
  } catch (error) {
    const offline = (target.kind === 'join' && error.httpStatus === 404) || error.name === 'TimeoutError' || ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.cause?.code || error.code);
    return { online: false, status: offline ? 'Offline' : 'Unknown', clients: null, maxClients: null, gameBuild: null, lockPure: null, ping: null, error: `${offline ? 'Offline — เซิร์ฟเวอร์ไม่ตอบกลับจากเครื่องนี้' : 'ตรวจสอบเซิร์ฟเวอร์ไม่ได้'}: ${error.message}`, checkedAt: new Date().toISOString() };
  }
}

export async function resolveInstallation(input = '', env = process.env) {
  if (typeof input !== 'string' || input.length > 1024 || /[\x00-\x1f]/.test(input)) throw new Error('พาธ FiveM ไม่ถูกต้อง');
  let selected = input.trim().replace(/%([a-z_]+)%/gi, (_, name) => env[name.toUpperCase()] || `%${name}%`);
  if (!selected) {
    if (!env.LOCALAPPDATA) throw new Error('ไม่พบ LOCALAPPDATA กรุณาระบุพาธ FiveM');
    selected = path.join(env.LOCALAPPDATA, 'FiveM');
  }
  if (!path.isAbsolute(selected)) throw new Error('กรุณาระบุพาธแบบเต็มของ FiveM');
  const resolved = path.resolve(selected);
  const base = path.basename(resolved).toLowerCase();
  const selectedRoot = base === 'fivem.exe' || base === 'fivem.app' ? path.dirname(resolved) : resolved;
  // A relocated installation may have a junction at its entry point. Anchor all
  // operations to that real root; links inside FiveM.app remain forbidden.
  const root = await fs.realpath(selectedRoot).catch(() => { throw new Error('ไม่พบ FiveM.exe กรุณาตรวจพาธในการตั้งค่า หรือติดตั้ง FiveM ก่อน'); });
  const exe = path.join(root, 'FiveM.exe');
  if (!(await fs.stat(exe).catch(() => null))?.isFile()) throw new Error('ไม่พบ FiveM.exe กรุณาตรวจพาธในการตั้งค่า หรือติดตั้ง FiveM ก่อน');
  return { root, exe, app: path.join(root, 'FiveM.app'), data: path.join(root, 'FiveM.app', 'data') };
}

export function buildLaunchArgs(server) {
  const target = parseTarget(server.ip);
  if (server.cl2 !== undefined && typeof server.cl2 !== 'boolean') throw new Error('ค่า CL2 ไม่ถูกต้อง');
  if (!['string', 'number'].includes(typeof server.gameBuild) || !/^[1-9]\d{3,4}$/.test(String(server.gameBuild))) throw new Error('ตรวจสอบ Game Build ปัจจุบันจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  if (!['string', 'number'].includes(typeof server.lockPure) || !/^[012]$/.test(String(server.lockPure))) throw new Error('ตรวจสอบ Pure Mode ปัจจุบันจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  // Explicit build bypasses FiveM's retained INI selection. Always include pure
  // 0 as well, so a previous city's protection level cannot carry over.
  return [...(server.cl2 ? ['-cl2'] : []), `-b${server.gameBuild}`, `-pure_${server.lockPure}`, `fivem://connect/${target.address}`];
}

export async function executeRealLaunch(server, dependencies = {}) {
  parseTarget(server.ip);
  if (server.cl2 !== undefined && typeof server.cl2 !== 'boolean') throw new Error('ค่า CL2 ไม่ถูกต้อง');
  const playerName = validatePlayerName(server.inGameName);
  if ((dependencies.platform || process.platform) !== 'win32') throw new Error('เปิดเกมได้บน Windows เท่านั้น');
  const installation = await resolveInstallation(server.fivemPath);
  const assertLaunchAllowed = async () => {
    if (server.cl2 === true && !playerName) return;
    let names;
    try { names = await (dependencies.getProcessNames || getProcessNames)(); }
    catch { throw Object.assign(new Error('ตรวจสอบสถานะ FiveM ไม่ได้ กรุณาลองใหม่ก่อนเริ่มเกม'), { status: 503 }); }
    if (names.some(isFiveMProcess)) throw Object.assign(new Error(playerName ? 'ต้องปิด FiveM ทุกหน้าต่างก่อนใช้ Name ของเมืองนี้ หากเปิด CL2 ให้เว้นช่อง Name ว่างเพื่อใช้ชื่อปัจจุบัน' : 'FiveM กำลังทำงานอยู่ กรุณาปิดเกมเดิม หรือเปิด CL2 เพื่อเริ่มเกมตัวที่สอง'), { status: 409 });
  };
  await assertLaunchAllowed();
  // Never trust cached renderer values, including launches from history/Tray.
  // Skip banner resolution so unrelated media cannot delay this final check.
  const serverInfo = await (dependencies.queryLiveServer || queryLiveServer)(server.ip, undefined, { includeMedia: false });
  if (!serverInfo.online || serverInfo.requirementsSource !== 'Direct HTTP') throw Object.assign(new Error('ตรวจสอบ Game Build และ Pure Mode จากเซิร์ฟเวอร์ปัจจุบันไม่ได้ กรุณาลองใหม่' + (serverInfo.error ? `: ${serverInfo.error}` : '')), { status: 503 });
  const args = buildLaunchArgs({ ...server, gameBuild: serverInfo.gameBuild, lockPure: serverInfo.lockPure });
  // The network check may take seconds; recheck before Name writes/dispatch.
  await assertLaunchAllowed();
  if (playerName) await (dependencies.applyPlayerName || applyPlayerName)(installation, playerName);
  await (dependencies.launchThroughExplorer || launchThroughExplorer)(installation, args);
  return { success: true, serverInfo: { gameBuild: serverInfo.gameBuild, lockPure: serverInfo.lockPure, checkedAt: serverInfo.checkedAt }, protocolUrl: `fivem://connect/${parseTarget(server.ip).address}`, message: `ส่งคำสั่งเปิด FiveM ด้วย Game Build ${serverInfo.gameBuild} / Pure Mode ${serverInfo.lockPure} แล้ว โปรดดูผลการเชื่อมต่อในเกม` };
}

async function assertNoLinks(absolute) {
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error('ไม่ล้างแคชผ่าน symbolic link หรือ junction');
  }
}
async function assertTreeNoLinks(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('พบ symbolic link/junction ในแคช กรุณาจัดการด้วยตนเอง');
    if (entry.isDirectory()) await assertTreeNoLinks(path.join(directory, entry.name));
  }
}

export async function executeRealCleanCache(options = {}, dependencies = {}) {
  const installation = await resolveInstallation(options.fivemPath);
  const names = await (dependencies.getProcessNames || getProcessNames)();
  if (names.some(isFiveMProcess)) throw new Error('กรุณาปิด FiveM ทุกหน้าต่างก่อนล้างแคช ระบบจะไม่บังคับปิดเกม');
  await assertNoLinks(installation.data);
  if (!(await fs.stat(installation.data).catch(() => null))?.isDirectory()) throw new Error('ไม่พบโฟลเดอร์ data ของ FiveM');
  const targets = ['server-cache', 'server-cache-priv', path.join('cache', 'subprocess')].map(name => ({ name, absolute: path.resolve(installation.data, name) }));
  // Validate every target before the first delete, including nested junctions.
  for (const target of targets) {
    const relative = path.relative(installation.data, target.absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('พาธอยู่นอกขอบเขตแคช');
    await assertNoLinks(target.absolute);
    target.exists = !!(await fs.stat(target.absolute).catch(() => null));
    if (target.exists) await assertTreeNoLinks(target.absolute);
  }
  const steps = [], errors = [];
  for (const target of targets) {
    if (!target.exists) { steps.push(`${target.name}: ไม่มีแคช`); continue; }
    try { await fs.rm(target.absolute, { recursive: true, force: false }); steps.push(`${target.name}: ลบแล้ว`); }
    catch (error) { errors.push(`${target.name}: ${error.code || 'ลบไม่สำเร็จ'}`); }
  }
  return { success: errors.length === 0, steps, error: errors.join('; ') || undefined };
}

