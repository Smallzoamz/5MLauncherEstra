const browserListeners = new Set();

export function subscribeBrowserOverlay(listener) {
  browserListeners.add(listener);
  return () => browserListeners.delete(listener);
}

export function buildOverlaySettingsPayload(settings) {
  return {
    enabled: settings?.overlayNotificationsEnabled !== false,
    notifyScreenshot: settings?.overlayNotifyScreenshot !== false,
    notifyFriendOnline: settings?.overlayNotifyFriendOnline !== false,
    notifyFriendInGame: settings?.overlayNotifyFriendInGame !== false
  };
}

export function syncOverlaySettings(settings) {
  if (!window?.estraWindow?.setOverlaySettings) return Promise.resolve(null);
  return window.estraWindow.setOverlaySettings(buildOverlaySettingsPayload(settings));
}

export function shouldDeliverOverlay(settings, kind, force = false) {
  if (force) return true;
  if (kind === 'schedule-alert') return settings?.overlayNotificationsEnabled !== false;
  if (settings?.overlayNotificationsEnabled === false) return false;
  if (kind === 'screenshot') return settings?.overlayNotifyScreenshot !== false;
  if (kind === 'friend-online') return settings?.overlayNotifyFriendOnline !== false;
  if (kind === 'friend-in-game') return settings?.overlayNotifyFriendInGame !== false;
  return true;
}

export function pushOverlayNotification(payload, { force = false, settings = null } = {}) {
  if (settings && !shouldDeliverOverlay(settings, payload?.kind, force)) {
    return Promise.resolve(false);
  }
  if (typeof window !== 'undefined' && window.estraWindow?.pushOverlayNotification) {
    return window.estraWindow.pushOverlayNotification(payload, force);
  }
  for (const listener of browserListeners) {
    try {
      listener(payload);
    } catch {}
  }
  return Promise.resolve(true);
}

export function buildFriendKey(friend) {
  const presence = friend?.presence || 'offline';
  const srv = friend?.currentServer;
  const serverKey =
    presence === 'in-game' && srv?.name
      ? `${srv.id || ''}|${srv.ip || ''}|${srv.name}`
      : '';
  return { presence, serverKey };
}

export function detectFriendOverlayTransitions(prevMap, nextFriends = []) {
  const nextMap = new Map();
  const notifications = [];
  const list = Array.isArray(nextFriends) ? nextFriends : [];

  for (const friend of list) {
    if (!friend?.id) continue;
    const { presence, serverKey } = buildFriendKey(friend);
    nextMap.set(friend.id, { presence, serverKey });
    if (!prevMap) continue;

    const prev = prevMap.get(friend.id);
    const displayName = String(friend.displayName || friend.username || 'เพื่อน').trim();
    const initials = displayName.slice(0, 2).toUpperCase() || 'FR';
    const imageUrl = typeof friend.avatarUrl === 'string' ? friend.avatarUrl : '';
    const accentColor = typeof friend.avatarColor === 'string' ? friend.avatarColor : '';

    if (presence === 'in-game' && friend.currentServer?.name) {
      if (!prev || prev.presence !== 'in-game' || prev.serverKey !== serverKey) {
        notifications.push({
          id: `friend-game-${friend.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'friend-in-game',
          badge: 'เพื่อนกำลังเข้าเล่น',
          title: displayName,
          subtitle: `กำลังเข้าเมือง ${friend.currentServer.name}`,
          detail: friend.currentServer.ip || 'FiveM',
          imageUrl,
          initials,
          accentColor: accentColor || '#2b6bf3',
          durationMs: 4800
        });
      }
      continue;
    }

    if (presence === 'online' && (!prev || prev.presence === 'offline')) {
      notifications.push({
        id: `friend-online-${friend.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'friend-online',
        badge: 'เพื่อนออนไลน์',
        title: displayName,
        subtitle: 'ออนไลน์บน Estra แล้ว',
        detail: friend.username ? `@${friend.username}` : '',
        imageUrl,
        initials,
        accentColor: accentColor || '#22c55e',
        durationMs: 4200
      });
    }
  }

  return { nextMap, notifications };
}

export function playOverlayFriendChime() {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const tone = (offset, freq, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.06, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + dur + 0.01);
    };
    tone(0, 587.33, 0.11);
    tone(0.09, 880.0, 0.16);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 350);
  } catch {}
}
