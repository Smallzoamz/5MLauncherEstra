export const MAX_USER_SERVERS = 200;
export const MAX_PLAYTIME_SECONDS = 315_360_000;

export function sanitizeHttpUrl(raw) {
  const val = String(raw || '').trim().slice(0, 500);
  if (!val) return '';
  return /^https?:\/\/\S{3,493}$/i.test(val) ? val : '';
}

export function sanitizePlaytimeSeconds(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(MAX_PLAYTIME_SECONDS, Math.floor(num));
}

export function sanitizeTimestampIso(raw) {
  if (!raw) return null;
  const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

export function sanitizeSyncServerItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().slice(0, 100);
  if (!id) return null;
  const name = String(raw.name || '').trim().slice(0, 100) || id;
  return {
    id,
    name,
    ip: String(raw.ip || '').trim().slice(0, 253),
    tag: String(raw.tag || '').trim().slice(0, 40),
    inGameName: String(raw.inGameName || '').trim().slice(0, 80),
    customBannerUrl: sanitizeHttpUrl(raw.customBannerUrl),
    cl2: Boolean(raw.cl2),
    favorite: Boolean(raw.favorite),
    patchManifestUrl: sanitizeHttpUrl(raw.patchManifestUrl),
    directorySlug: String(raw.directorySlug || '').trim().slice(0, 100),
    lastFetchedName: String(raw.lastFetchedName || '').trim().slice(0, 100),
    playtimeSeconds: sanitizePlaytimeSeconds(raw.playtimeSeconds),
    lastPlayedAt: sanitizeTimestampIso(raw.lastPlayedAt),
  };
}

export function sanitizeSyncServerList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const item = sanitizeSyncServerItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_USER_SERVERS) break;
  }
  return out;
}

export function buildServersSyncPayload(servers, activeServerId) {
  return {
    servers: sanitizeSyncServerList(servers),
    activeServerId: String(activeServerId || '').trim().slice(0, 100),
  };
}

export function buildServersSyncSignature(servers, activeServerId) {
  return JSON.stringify(buildServersSyncPayload(servers, activeServerId));
}

export function mergeCloudServersWithLocalCache(cloudServers, localCachedServers, resetServerFn = s => s) {
  const cacheById = new Map();
  if (Array.isArray(localCachedServers)) {
    for (const item of localCachedServers) {
      if (item && item.id) cacheById.set(String(item.id), item);
    }
  }
  return sanitizeSyncServerList(cloudServers).map(cloud => {
    const cached = cacheById.get(cloud.id);
    return resetServerFn({
      ...cloud,
      logoUrl: cached?.logoUrl || '',
      iconSource: cached?.iconSource || '',
      bannerUrl: cached?.bannerUrl || '',
      connectingBannerUrl: cached?.connectingBannerUrl || '',
      lastOnlineAt: cached?.lastOnlineAt || null,
    });
  });
}
