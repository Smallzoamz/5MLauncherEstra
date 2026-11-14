import dns from 'node:dns/promises';
import net from 'node:net';

export function parseFiveMTarget(value) {
  if (typeof value !== 'string' || value.length > 253) {
    throw new Error('กรุณาระบุ IP:port, โดเมน:port หรือ cfx.re/join/code');
  }
  const input = value.trim();
  const join = input.match(/^(?:https?:\/\/)?cfx\.re\/join\/([a-z0-9]{4,16})\/?$/i);
  if (join) {
    const code = join[1].toLowerCase();
    return { kind: 'join', code, address: `cfx.re/join/${code}` };
  }

  const match = input.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/i);
  if (!match) {
    throw new Error('รูปแบบที่อยู่ไม่ถูกต้อง ใช้ IP:port, โดเมน หรือ cfx.re/join/code');
  }

  const host = match[1].toLowerCase();
  const port = Number(match[2] || 30120);
  if (
    port < 1 ||
    port > 65535 ||
    host.split('.').some(p => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'))
  ) {
    throw new Error('โดเมนหรือพอร์ตไม่ถูกต้อง');
  }

  if (/^[0-9.]+$/.test(host)) {
    const parts = host.split('.');
    if (parts.length !== 4 || parts.some(p => Number(p) > 255 || (p.length > 1 && p[0] === '0'))) {
      throw new Error('IPv4 ไม่ถูกต้อง');
    }
  }

  return { kind: 'direct', host, port, address: `${host}:${port}` };
}

export function isPublicIpAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
    if (a === 169 && b === 254) return false; // Link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
    if (a === 192 && b === 168) return false; // RFC1918
    if (a === 192 && b === 0 && ip.split('.')[2] === '0') return false;
    if (a >= 224) return false; // Multicast / reserved
    return true;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false; // ULA
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return false; // Link-local fe80::/10
    }
    if (lower.startsWith('::ffff:')) {
      return isPublicIpAddress(lower.slice(7));
    }
    return true;
  }
  return false;
}

export async function assertPublicHost(host, lookupImpl = dns.lookup) {
  const lower = String(host || '').toLowerCase();
  if (
    !lower ||
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    throw new Error('ไม่อนุญาตให้ตรวจสอบที่อยู่เครือข่ายภายใน (Local/Private Host)');
  }

  if (net.isIP(lower)) {
    if (!isPublicIpAddress(lower)) {
      throw new Error('ไม่อนุญาตให้ตรวจสอบ IP ภายในหรือ IP ต้องห้าม');
    }
    return;
  }

  const records = await lookupImpl(lower, { all: true });
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('ไม่พบข้อมูล DNS ของโดเมนนี้');
  }
  for (const rec of records) {
    if (!isPublicIpAddress(rec.address)) {
      throw new Error('โดเมนนี้ชี้ไปยัง IP ภายในเครือข่าย จึงถูกบล็อกเพื่อความปลอดภัย');
    }
  }
}

export function stripFiveMColors(text) {
  return String(text || '')
    .replace(/\^[0-9]/g, '')
    .replace(/~[a-zA-Z]~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchBoundedJson(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(4500),
    redirect: 'error',
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Estra-Discord-Bot/1.0' },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
  }

  const text = await res.text();
  if (text.length > 1024 * 1024) {
    throw new Error('ข้อมูลจากเซิร์ฟเวอร์มีขนาดใหญ่เกินกำหนด');
  }
  return JSON.parse(text);
}

const parseIntCount = val =>
  val !== null && val !== undefined && val !== '' && Number.isInteger(Number(val)) && Number(val) >= 0
    ? Number(val)
    : null;

export async function queryFiveMServerForDiscord(
  rawTarget,
  { fetchImpl = fetch, lookupImpl = dns.lookup } = {},
) {
  const target = parseFiveMTarget(rawTarget);
  const startedAt = Date.now();

  let dynamic;
  let info;
  let requirementsInfo = null;

  if (target.kind === 'join') {
    const response = await fetchBoundedJson(
      `https://servers-frontend.fivem.net/api/servers/single/${target.code}`,
      fetchImpl,
    );
    const data = response?.Data;
    if (!data || parseIntCount(data.clients) === null) {
      throw new Error('ไม่พบข้อมูลเซิร์ฟเวอร์บน Cfx.re');
    }
    dynamic = { ...data, sv_maxclients: data.svMaxclients };
    info = data;

    const endpoints = Array.isArray(data.connectEndPoints) ? data.connectEndPoints.slice(0, 2) : [];
    for (const ep of endpoints) {
      try {
        const direct = parseFiveMTarget(String(ep));
        if (direct.kind !== 'direct') continue;
        await assertPublicHost(direct.host, lookupImpl);
        const details = await fetchBoundedJson(`http://${direct.address}/info.json`, fetchImpl);
        if (details && typeof details === 'object' && !Array.isArray(details)) {
          requirementsInfo = details;
          break;
        }
      } catch {
        // Skip private or unreachable endpoint; keep listing fallback
      }
    }
  } else {
    await assertPublicHost(target.host, lookupImpl);
    [dynamic, info] = await Promise.all([
      fetchBoundedJson(`http://${target.address}/dynamic.json`, fetchImpl),
      fetchBoundedJson(`http://${target.address}/info.json`, fetchImpl).catch(() => null),
    ]);
    if (!dynamic || parseIntCount(dynamic.clients) === null) {
      throw new Error('ปลายทางไม่ได้ส่งข้อมูลสถานะ FiveM ที่ถูกต้อง');
    }
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      requirementsInfo = info;
    }
    info ||= {};
  }

  const vars = info.vars || {};
  const reqVars = (requirementsInfo || info).vars || {};
  const rawBuild = String(reqVars.sv_enforceGameBuild ?? '');
  const rawPure = String(reqVars.sv_pureLevel ?? '');
  const gameBuild = /^[1-9]\d{3,4}$/.test(rawBuild) ? rawBuild : null;
  const lockPure = /^[012]$/.test(rawPure) ? Number(rawPure) : null;

  const launchArgsPreview = gameBuild && lockPure !== null
    ? `-b${gameBuild} -pure_${lockPure} fivem://connect/${target.address}`
    : `fivem://connect/${target.address}`;

  return {
    online: true,
    address: target.address,
    hostname: stripFiveMColors(dynamic.hostname || vars.sv_projectName || target.address).slice(0, 180),
    clients: parseIntCount(dynamic.clients),
    maxClients: parseIntCount(dynamic.sv_maxclients),
    gameBuild,
    lockPure,
    requirementsSource: requirementsInfo ? 'Direct HTTP' : 'Cfx.re Listing',
    pingMs: Date.now() - startedAt,
    launchArgsPreview,
  };
}
