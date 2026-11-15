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
      screenshotDir: '  D:\\EstraShots  '
    },
    '  Los Santos City  '
  );
  assert.deepEqual(payload, {
    enabled: true,
    hotkey: 'Ctrl+F11',
    onlyInGame: true,
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
