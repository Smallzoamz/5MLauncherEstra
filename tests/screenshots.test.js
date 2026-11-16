import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScreenshotConfigPayload,
  formatShotBytes,
  normalizeScreenshotHotkey,
  syncScreenshotSettings
} from '../src/services/screenshotService.js';
import {
  detectFriendOverlayTransitions,
  shouldDeliverOverlay
} from '../src/services/overlayService.js';
import {
  buildClockOverlaySettingsPayload,
  buildPerfOverlaySettingsPayload,
  formatHudDateTime,
  formatPerfMetric,
  normalizePerfOverlayPosition,
  syncClockOverlaySettings,
  syncPerfOverlaySettings
} from '../src/services/perfOverlayService.js';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../src/services/storageService.js';

function withMockLocalStorage(fn) {
  const store = new Map();
  const prevStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => { store.set(key, String(val)); },
    removeItem: key => { store.delete(key); }
  };
  try {
    return fn(store);
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }
}

test('screenshotService normalizes hotkeys, formats bytes, and builds IPC payload', async () => {
  assert.equal(normalizeScreenshotHotkey('f12'), 'F12');
  assert.equal(normalizeScreenshotHotkey('ctrl + f12'), 'Ctrl+F12');
  assert.equal(normalizeScreenshotHotkey('PrintScreen'), 'PrintScreen');
  assert.equal(normalizeScreenshotHotkey('InvalidKey'), 'F12');

  assert.equal(formatShotBytes(512), '512 B');
  assert.equal(formatShotBytes(2048), '2.0 KB');
  assert.equal(formatShotBytes(1024 * 1024 * 2), '2.00 MB');

  const payload = buildScreenshotConfigPayload(
    {
      screenshotEnabled: true,
      screenshotHotkey: 'ctrl+f11',
      screenshotOnlyInGame: true,
      perfOverlayIncludeInScreenshots: true,
      clockOverlayIncludeInScreenshots: true,
      screenshotDir: '  D:\\EstraShots  '
    },
    '  Los Santos City  '
  );
  assert.deepEqual(payload, {
    enabled: true,
    hotkey: 'Ctrl+F11',
    onlyInGame: true,
    includePerfOverlay: true,
    includeClockOverlay: true,
    dir: 'D:\\EstraShots',
    cityName: 'Los Santos City'
  });

  const prevWindow = globalThis.window;
  let capturedPayload = null;
  globalThis.window = {
    estraWindow: {
      setScreenshotConfig: async cfg => {
        capturedPayload = cfg;
        return cfg;
      }
    }
  };
  try {
    await syncScreenshotSettings({ screenshotEnabled: false, screenshotHotkey: 'F9' }, 'Test City');
    assert.deepEqual(capturedPayload, {
      enabled: false,
      hotkey: 'F9',
      onlyInGame: false,
      includePerfOverlay: false,
      includeClockOverlay: false,
      dir: '',
      cityName: 'Test City'
    });
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

test('storageService persists screenshot preferences with safe defaults', () => {
  withMockLocalStorage(() => {
    assert.equal(DEFAULT_SETTINGS.screenshotEnabled, true);
    assert.equal(DEFAULT_SETTINGS.screenshotHotkey, 'F12');
    assert.equal(DEFAULT_SETTINGS.screenshotOnlyInGame, false);
    assert.equal(DEFAULT_SETTINGS.screenshotPlaySound, true);
    assert.equal(DEFAULT_SETTINGS.screenshotDir, '');

    saveSettings({
      ...DEFAULT_SETTINGS,
      screenshotEnabled: false,
      screenshotHotkey: 'Ctrl+F12',
      screenshotOnlyInGame: true,
      screenshotPlaySound: false,
      screenshotDir: 'D:\\MyShots'
    });

    const loaded = getSettings();
    assert.equal(loaded.screenshotEnabled, false);
    assert.equal(loaded.screenshotHotkey, 'Ctrl+F12');
    assert.equal(loaded.screenshotOnlyInGame, true);
    assert.equal(loaded.screenshotPlaySound, false);
    assert.equal(loaded.screenshotDir, 'D:\\MyShots');
  });
});

test('perfOverlayService builds IPC payloads, formats metrics, and persists F12 capture option', async () => {
  assert.equal(normalizePerfOverlayPosition('TOP-RIGHT'), 'top-right');
  assert.equal(normalizePerfOverlayPosition('unknown'), 'top-left');
  assert.equal(formatPerfMetric(null, '%'), '--');
  assert.equal(formatPerfMetric(64.6, '%'), '65%');
  assert.equal(formatPerfMetric(119.8), '120');

  const payload = buildPerfOverlaySettingsPayload({
    perfOverlayEnabled: true,
    perfOverlayOnlyInGame: true,
    perfOverlayIncludeInScreenshots: true,
    perfOverlayPosition: 'bottom-left'
  });
  assert.deepEqual(payload, {
    enabled: true,
    onlyInGame: true,
    includeInScreenshots: true,
    position: 'bottom-left'
  });

  withMockLocalStorage(() => {
    assert.equal(DEFAULT_SETTINGS.perfOverlayEnabled, false);
    assert.equal(DEFAULT_SETTINGS.perfOverlayIncludeInScreenshots, false);
    assert.equal(DEFAULT_SETTINGS.perfOverlayPosition, 'top-left');

    saveSettings({
      ...DEFAULT_SETTINGS,
      perfOverlayEnabled: true,
      perfOverlayOnlyInGame: true,
      perfOverlayIncludeInScreenshots: true,
      perfOverlayPosition: 'top-right'
    });

    const loaded = getSettings();
    assert.equal(loaded.perfOverlayEnabled, true);
    assert.equal(loaded.perfOverlayOnlyInGame, true);
    assert.equal(loaded.perfOverlayIncludeInScreenshots, true);
    assert.equal(loaded.perfOverlayPosition, 'top-right');
  });

  const prevWindow = globalThis.window;
  let sent = null;
  globalThis.window = {
    estraWindow: {
      setPerfOverlaySettings: async cfg => {
        sent = cfg;
        return cfg;
      }
    }
  };
  try {
    await syncPerfOverlaySettings({
      perfOverlayEnabled: true,
      perfOverlayIncludeInScreenshots: false,
      perfOverlayPosition: 'bottom-right'
    });
    assert.deepEqual(sent, {
      enabled: true,
      onlyInGame: false,
      includeInScreenshots: false,
      position: 'bottom-right'
    });
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

test('clock overlay builds IPC payloads, formats local date/time, and persists settings', async () => {
  const formatted = formatHudDateTime(new Date(2026, 10, 16, 20, 5, 9));
  assert.deepEqual(formatted, { dateText: '16/11/2026', timeText: '20:05:09' });

  const payload = buildClockOverlaySettingsPayload({
    clockOverlayEnabled: true,
    clockOverlayOnlyInGame: false,
    clockOverlayIncludeInScreenshots: true,
    clockOverlayPosition: 'invalid'
  });
  assert.deepEqual(payload, {
    enabled: true,
    onlyInGame: false,
    includeInScreenshots: true,
    position: 'top-right'
  });

  withMockLocalStorage(() => {
    assert.equal(DEFAULT_SETTINGS.clockOverlayEnabled, false);
    assert.equal(DEFAULT_SETTINGS.clockOverlayPosition, 'top-right');
    assert.equal(DEFAULT_SETTINGS.clockOverlayIncludeInScreenshots, false);

    saveSettings({
      ...DEFAULT_SETTINGS,
      clockOverlayEnabled: true,
      clockOverlayOnlyInGame: true,
      clockOverlayIncludeInScreenshots: true,
      clockOverlayPosition: 'top-left'
    });

    const loaded = getSettings();
    assert.equal(loaded.clockOverlayEnabled, true);
    assert.equal(loaded.clockOverlayOnlyInGame, true);
    assert.equal(loaded.clockOverlayIncludeInScreenshots, true);
    assert.equal(loaded.clockOverlayPosition, 'top-left');
  });

  const prevWindow = globalThis.window;
  let sentClock = null;
  globalThis.window = {
    estraWindow: {
      setClockOverlaySettings: async cfg => {
        sentClock = cfg;
        return cfg;
      }
    }
  };
  try {
    await syncClockOverlaySettings({
      clockOverlayEnabled: true,
      clockOverlayOnlyInGame: true,
      clockOverlayIncludeInScreenshots: true,
      clockOverlayPosition: 'bottom-left'
    });
    assert.deepEqual(sentClock, {
      enabled: true,
      onlyInGame: true,
      includeInScreenshots: true,
      position: 'bottom-left'
    });
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

test('overlayService detects friend online and in-game transitions without initial login spam', () => {
  const initialFriends = [
    { id: 'f1', username: 'alice', displayName: 'Alice', presence: 'online', currentServer: null },
    { id: 'f2', username: 'bob', displayName: 'Bob', presence: 'offline', currentServer: null }
  ];

  // First snapshot establishes baseline without firing alerts.
  const first = detectFriendOverlayTransitions(null, initialFriends);
  assert.equal(first.notifications.length, 0);

  // Alice starts joining a city; Bob comes online.
  const second = detectFriendOverlayTransitions(first.nextMap, [
    {
      id: 'f1',
      username: 'alice',
      displayName: 'Alice',
      presence: 'in-game',
      currentServer: { id: 'city-a', name: 'Estra City', ip: 'cfx.re/join/abc' }
    },
    { id: 'f2', username: 'bob', displayName: 'Bob', presence: 'online', currentServer: null }
  ]);
  assert.equal(second.notifications.length, 2);
  assert.equal(second.notifications[0].kind, 'friend-in-game');
  assert.equal(second.notifications[0].title, 'Alice');
  assert.match(second.notifications[0].subtitle, /Estra City/);
  assert.equal(second.notifications[1].kind, 'friend-online');
  assert.equal(second.notifications[1].title, 'Bob');

  // Repeated identical poll does not re-notify; switching cities notifies again.
  const repeat = detectFriendOverlayTransitions(second.nextMap, [
    {
      id: 'f1',
      username: 'alice',
      displayName: 'Alice',
      presence: 'in-game',
      currentServer: { id: 'city-a', name: 'Estra City', ip: 'cfx.re/join/abc' }
    },
    { id: 'f2', username: 'bob', displayName: 'Bob', presence: 'online', currentServer: null }
  ]);
  assert.equal(repeat.notifications.length, 0);

  const citySwitch = detectFriendOverlayTransitions(repeat.nextMap, [
    {
      id: 'f1',
      username: 'alice',
      displayName: 'Alice',
      presence: 'in-game',
      currentServer: { id: 'city-b', name: 'Neon Town', ip: 'cfx.re/join/xyz' }
    },
    { id: 'f2', username: 'bob', displayName: 'Bob', presence: 'online', currentServer: null }
  ]);
  assert.equal(citySwitch.notifications.length, 1);
  assert.equal(citySwitch.notifications[0].kind, 'friend-in-game');
  assert.match(citySwitch.notifications[0].subtitle, /Neon Town/);

  assert.equal(shouldDeliverOverlay({ overlayNotificationsEnabled: false }, 'friend-online', false), false);
  assert.equal(shouldDeliverOverlay({ overlayNotificationsEnabled: false }, 'friend-online', true), true);
  assert.equal(shouldDeliverOverlay({ overlayNotificationsEnabled: true, overlayNotifyFriendInGame: false }, 'friend-in-game', false), false);
  assert.equal(shouldDeliverOverlay({ overlayNotificationsEnabled: true, overlayNotifyScreenshot: true }, 'screenshot', false), true);
});
