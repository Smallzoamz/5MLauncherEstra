const CHAT_CACHE_PREFIX = 'estra_dm_cache_v1:';
const CHAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_PAIR_CAP = 50;

function cacheKey(userId, friendId) {
  return `${CHAT_CACHE_PREFIX}${userId}:${friendId}`;
}

export function normalizeChatMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!Number.isFinite(id) || !body) return null;
  return {
    id,
    senderId: String(raw.senderId || ''),
    recipientId: String(raw.recipientId || ''),
    body,
    readAt: raw.readAt || null,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    expiresAt: raw.expiresAt ? String(raw.expiresAt) : null
  };
}

export function pruneChatMessages(list, now = Date.now()) {
  const byId = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const msg = normalizeChatMessage(item);
    if (!msg) continue;
    const exp = msg.expiresAt ? Date.parse(msg.expiresAt) : NaN;
    if (Number.isFinite(exp)) {
      if (exp <= now) continue;
    } else {
      const created = Date.parse(msg.createdAt);
      if (Number.isFinite(created) && now - created > CHAT_RETENTION_MS) continue;
    }
    byId.set(msg.id, msg);
  }
  const sorted = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  return sorted.length > CHAT_PAIR_CAP ? sorted.slice(sorted.length - CHAT_PAIR_CAP) : sorted;
}

export function loadCachedChat(userId, friendId) {
  if (!userId || !friendId) return [];
  try {
    const raw = localStorage.getItem(cacheKey(userId, friendId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return pruneChatMessages(parsed);
  } catch {
    return [];
  }
}

export function saveCachedChat(userId, friendId, messages) {
  if (!userId || !friendId) return [];
  const pruned = pruneChatMessages(messages);
  try {
    if (pruned.length === 0) {
      localStorage.removeItem(cacheKey(userId, friendId));
    } else {
      localStorage.setItem(cacheKey(userId, friendId), JSON.stringify(pruned));
    }
  } catch {}
  return pruned;
}

export function clearUserChatCache(userId) {
  if (!userId) return;
  try {
    const prefix = `${CHAT_CACHE_PREFIX}${userId}:`;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {}
}
