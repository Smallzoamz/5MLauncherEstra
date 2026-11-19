const WATCHER_STORAGE_KEY = 'estra_server_watchers_v1';
const PING_HISTORY_MAX = 20;

export const ALLOWED_WATCHER_INTERVALS_SEC = [20, 30, 45];
export const ALLOWED_FREE_SLOT_THRESHOLDS = [1, 3, 5, 10];

export function sanitizeWatcherRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const serverId = String(raw.serverId || '').trim();
  if (!serverId) return null;
  const intervalSec = ALLOWED_WATCHER_INTERVALS_SEC.includes(Number(raw.intervalSec))
    ? Number(raw.intervalSec)
    : 30;
  const minFreeSlots = Math.max(1, Math.min(50, Math.floor(Number(raw.minFreeSlots) || 1)));
  return {
    serverId,
    enabled: Boolean(raw.enabled),
    watchRestart: raw.watchRestart !== false,
    watchFreeSlots: Boolean(raw.watchFreeSlots),
    minFreeSlots,
    intervalSec,
    armedRestart: raw.armedRestart !== false,
    armedSlots: raw.armedSlots !== false,
    lastStatus: typeof raw.lastStatus === 'string' ? raw.lastStatus : 'Unknown',
    lastClients: Number.isFinite(Number(raw.lastClients)) ? Number(raw.lastClients) : null,
    lastMaxClients: Number.isFinite(Number(raw.lastMaxClients)) ? Number(raw.lastMaxClients) : null,
    lastCheckedAt: typeof raw.lastCheckedAt === 'string' ? raw.lastCheckedAt : null,
    lastTriggeredAt: typeof raw.lastTriggeredAt === 'string' ? raw.lastTriggeredAt : null
  };
}

export function loadWatcherMap(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(WATCHER_STORAGE_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [id, item] of Object.entries(raw)) {
      const clean = sanitizeWatcherRule({ ...item, serverId: id });
      if (clean) out[id] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveWatcherMap(map, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return;
  try {
    const clean = {};
    for (const [id, item] of Object.entries(map || {})) {
      const rule = sanitizeWatcherRule({ ...item, serverId: id });
      if (rule && rule.enabled) clean[id] = rule;
    }
    storage.setItem(WATCHER_STORAGE_KEY, JSON.stringify(clean));
  } catch {}
}

export function createDefaultWatcherRule(server) {
  const isOffline = server?.status === 'Offline';
  const isFull =
    server?.status === 'Online' &&
    Number(server?.maxPlayers) > 0 &&
    Number(server?.onlinePlayers) >= Number(server?.maxPlayers);
  return {
    serverId: server?.id || '',
    enabled: true,
    watchRestart: true,
    watchFreeSlots: isFull || !isOffline,
    minFreeSlots: 1,
    intervalSec: 30,
    armedRestart: true,
    armedSlots: true,
    lastStatus: server?.status || 'Unknown',
    lastClients: Number.isFinite(Number(server?.onlinePlayers)) ? Number(server.onlinePlayers) : null,
    lastMaxClients: Number.isFinite(Number(server?.maxPlayers)) ? Number(server.maxPlayers) : null,
    lastCheckedAt: null,
    lastTriggeredAt: null
  };
}

/**
 * Pure transition evaluator for Server Restart & Free Slot Watcher.
 * Never spams: disarms the specific trigger once fired until the condition resets or user re-arms.
 */
export function evaluateWatcherTransition(rule, server, result, nowIso = new Date().toISOString()) {
  const next = {
    ...rule,
    lastStatus: result?.status || 'Unknown',
    lastClients: Number.isFinite(Number(result?.clients)) ? Number(result.clients) : null,
    lastMaxClients: Number.isFinite(Number(result?.maxClients)) ? Number(result.maxClients) : null,
    lastCheckedAt: nowIso
  };
  const events = [];

  const prevStatus = rule.lastStatus || 'Unknown';
  const currStatus = next.lastStatus;

  // Re-arm restart alert automatically if server drops Offline again
  if (currStatus === 'Offline') {
    next.armedRestart = true;
  }

  // Trigger 1: Offline -> Online (Server Restart Finished)
  if (
    rule.enabled &&
    rule.watchRestart &&
    rule.armedRestart &&
    prevStatus === 'Offline' &&
    currStatus === 'Online'
  ) {
    next.armedRestart = false;
    next.lastTriggeredAt = nowIso;
    events.push({
      reason: 'restart-online',
      serverId: server.id,
      serverName: server.name,
      serverIp: server.ip,
      badge: 'เมืองเปิดแล้ว',
      title: server.name,
      subtitle: 'เซิร์ฟเวอร์รีสตาร์ทเสร็จและกลับมาออนไลน์แล้ว',
      detail:
        next.lastMaxClients > 0
          ? `${next.lastClients ?? 0}/${next.lastMaxClients} คน`
          : 'Online',
      triggeredAt: nowIso
    });
  }

  // Trigger 2: Free Slots Available (e.g., server was full/below threshold and now has >= minFreeSlots)
  const currFree =
    currStatus === 'Online' && next.lastMaxClients > 0 && next.lastClients != null
      ? Math.max(0, next.lastMaxClients - next.lastClients)
      : null;
  const prevFree =
    prevStatus === 'Online' && rule.lastMaxClients > 0 && rule.lastClients != null
      ? Math.max(0, rule.lastMaxClients - rule.lastClients)
      : null;

  if (currFree != null && currFree < rule.minFreeSlots) {
    next.armedSlots = true;
  }

  if (
    rule.enabled &&
    rule.watchFreeSlots &&
    rule.armedSlots &&
    currFree != null &&
    currFree >= rule.minFreeSlots &&
    (prevFree == null || prevFree < rule.minFreeSlots)
  ) {
    // Avoid double-triggering if restart-online already fired on the exact same tick
    if (!events.some(e => e.reason === 'restart-online')) {
      next.armedSlots = false;
      next.lastTriggeredAt = nowIso;
      events.push({
        reason: 'slots-available',
        serverId: server.id,
        serverName: server.name,
        serverIp: server.ip,
        badge: 'มีสล็อตว่างแล้ว',
        title: server.name,
        subtitle: `ว่าง ${currFree} ที่ (${next.lastClients}/${next.lastMaxClients} คน)`,
        detail: `เป้าหมาย ≥ ${rule.minFreeSlots} ที่`,
        triggeredAt: nowIso
      });
    }
  }

  return { nextRule: next, events };
}

export function appendPingHistory(historyList = [], point) {
  const clean = Array.isArray(historyList) ? historyList : [];
  if (!point) return clean;
  return [...clean, point].slice(-PING_HISTORY_MAX);
}

export async function probeServerRoute(target, samples = 6) {
  if (typeof window !== 'undefined' && window.estraWindow?.probeServerRoute) {
    return window.estraWindow.probeServerRoute({
      target: String(target || ''),
      samples: Number(samples) || 6
    });
  }
  throw new Error('การทดสอบ TCP Ping/Jitter รองรับเฉพาะ Estra Desktop (Tauri)');
}
