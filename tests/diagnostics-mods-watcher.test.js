import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLEAN_PURE_PRESET_ID,
  evaluatePureModeCompatibility,
  resolvePresetSwitchForLaunch
} from '../src/services/modPresetService.js';
import {
  appendPingHistory,
  createDefaultWatcherRule,
  evaluateWatcherTransition,
  loadWatcherMap,
  saveWatcherMap
} from '../src/services/serverWatcherService.js';
import { formatBytesCompact, analyzeCrashLogs } from '../src/services/crashAnalyzerService.js';
import { buildOverlaySettingsPayload, shouldDeliverOverlay } from '../src/services/overlayService.js';
import { prepareLaunch } from '../src/services/prepareLaunch.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
}

test('modPresetService evaluates Pure Mode conflicts and launch auto-switch plans accurately', () => {
  const modState = {
    activePresetId: 'nve-ultra',
    hasActiveMods: true,
    liveModsFiles: 12,
    livePluginsFiles: 2,
    presets: [
      { id: CLEAN_PURE_PRESET_ID, name: 'Clean Pure Mode', pureSafe: true },
      { id: 'nve-ultra', name: 'NVE Ultra', pureSafe: false }
    ]
  };

  const pureServer = { id: 'city-1', name: 'Pure City', lockPure: 2, modPresetId: '' };
  const compat = evaluatePureModeCompatibility(pureServer, modState);
  assert.equal(compat.status, 'conflict');
  assert.equal(compat.mismatch, true);
  assert.equal(compat.targetPresetId, CLEAN_PURE_PRESET_ID);

  // Without autoCleanModsForPureMode, no automatic switch occurs unless bound
  assert.equal(resolvePresetSwitchForLaunch(pureServer, { autoCleanModsForPureMode: false }, modState), null);

  // With autoCleanModsForPureMode enabled, plans switch to clean-pure
  const purePlan = resolvePresetSwitchForLaunch(pureServer, { autoCleanModsForPureMode: true }, modState);
  assert.deepEqual(purePlan, { presetId: CLEAN_PURE_PRESET_ID, reason: 'pure-guard' });

  // Bound server preset takes priority over autoClean
  const boundServer = { id: 'city-2', name: 'RP City', lockPure: 0, modPresetId: CLEAN_PURE_PRESET_ID };
  const boundPlan = resolvePresetSwitchForLaunch(boundServer, { autoCleanModsForPureMode: false }, modState);
  assert.deepEqual(boundPlan, { presetId: CLEAN_PURE_PRESET_ID, reason: 'bound' });
});

test('prepareLaunch auto-switches mod preset before dispatch when FiveM is closed', async () => {
  const calls = [];
  const server = { id: 's1', name: 'Pure City', ip: '127.0.0.1:30120', lockPure: 2, cl2: false, inGameName: '' };
  const settings = {
    fivemPath: 'D:\\FiveM',
    checkMicBeforeLaunch: false,
    requireSteamDiscordBeforeLaunch: false,
    autoClearCacheBeforeLaunch: false,
    autoCleanModsForPureMode: true
  };

  const result = await prepareLaunch(server, settings, {
    installation: async () => ({ exe: 'D:\\FiveM\\FiveM.exe' }),
    presence: async () => ({ fivem: { running: false }, steam: { running: true }, discord: { running: true } }),
    loadModPresets: async () => ({
      activePresetId: 'my-mods',
      hasActiveMods: true,
      presets: [
        { id: CLEAN_PURE_PRESET_ID, name: 'Clean Pure Mode', pureSafe: true },
        { id: 'my-mods', name: 'My Mods', pureSafe: false }
      ]
    }),
    applyModPreset: async (path, presetId) => {
      calls.push({ path, presetId });
      return {
        activePresetId: presetId,
        hasActiveMods: false,
        presets: [{ id: CLEAN_PURE_PRESET_ID, name: 'Clean Pure Mode', pureSafe: true }]
      };
    },
    dispatch: async () => ({ success: true, message: 'Launched' })
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { path: 'D:\\FiveM', presetId: CLEAN_PURE_PRESET_ID });
  assert.match(result.message, /Clean Pure Mode/);
});

test('serverWatcherService triggers restart-online once, disarms, and re-arms on offline', () => {
  const server = { id: 'srv-1', name: 'Estra City', ip: '1.2.3.4:30120', status: 'Offline' };
  const rule0 = createDefaultWatcherRule(server);
  rule0.watchRestart = true;
  rule0.watchFreeSlots = true;
  rule0.minFreeSlots = 1;

  // Offline -> Online fires restart-online (and does not double-fire slots-available on same tick)
  const step1 = evaluateWatcherTransition(rule0, server, {
    status: 'Online',
    clients: 10,
    maxClients: 200
  }, '2026-11-19T04:00:00.000Z');
  assert.equal(step1.events.length, 1);
  assert.equal(step1.events[0].reason, 'restart-online');
  assert.equal(step1.nextRule.armedRestart, false);

  // Subsequent Online poll does not spam
  const step2 = evaluateWatcherTransition(step1.nextRule, server, {
    status: 'Online',
    clients: 12,
    maxClients: 200
  });
  assert.equal(step2.events.length, 0);

  // Server drops Offline -> re-arms restart trigger
  const step3 = evaluateWatcherTransition(step2.nextRule, server, {
    status: 'Offline',
    clients: null,
    maxClients: null
  });
  assert.equal(step3.events.length, 0);
  assert.equal(step3.nextRule.armedRestart, true);
});

test('serverWatcherService triggers slots-available only when free slots cross threshold', () => {
  const server = { id: 'srv-2', name: 'Full City', ip: '5.6.7.8:30120', status: 'Online', onlinePlayers: 300, maxPlayers: 300 };
  const rule = {
    ...createDefaultWatcherRule(server),
    watchRestart: false,
    watchFreeSlots: true,
    minFreeSlots: 3,
    lastStatus: 'Online',
    lastClients: 300,
    lastMaxClients: 300
  };

  // Only 2 free slots (< 3) -> no trigger
  const s1 = evaluateWatcherTransition(rule, server, { status: 'Online', clients: 298, maxClients: 300 });
  assert.equal(s1.events.length, 0);

  // 4 free slots (>= 3) -> fires once and disarms
  const s2 = evaluateWatcherTransition(s1.nextRule, server, { status: 'Online', clients: 296, maxClients: 300 });
  assert.equal(s2.events.length, 1);
  assert.equal(s2.events[0].reason, 'slots-available');
  assert.equal(s2.nextRule.armedSlots, false);

  // Still 5 free slots -> no repeat spam
  const s3 = evaluateWatcherTransition(s2.nextRule, server, { status: 'Online', clients: 295, maxClients: 300 });
  assert.equal(s3.events.length, 0);
});

test('serverWatcherService persists enabled watchers and caps ping history at 20 points', () => {
  const storage = createMemoryStorage();
  saveWatcherMap(
    {
      a: { serverId: 'a', enabled: true, intervalSec: 20, minFreeSlots: 5 },
      b: { serverId: 'b', enabled: false, intervalSec: 999 }
    },
    storage
  );
  const loaded = loadWatcherMap(storage);
  assert.ok(loaded.a);
  assert.equal(loaded.a.intervalSec, 20);
  assert.equal(loaded.a.minFreeSlots, 5);
  assert.equal(loaded.b, undefined);

  let hist = [];
  for (let i = 1; i <= 25; i++) hist = appendPingHistory(hist, { ts: i, ping: i * 2 });
  assert.equal(hist.length, 20);
  assert.equal(hist[0].ts, 6);
  assert.equal(hist[19].ts, 25);
});

test('overlayService respects server-watcher category toggle and crashAnalyzerService formats safely', async () => {
  const payload = buildOverlaySettingsPayload({ overlayNotificationsEnabled: true, overlayNotifyServerWatcher: false });
  assert.equal(payload.notifyServerWatcher, false);
  assert.equal(shouldDeliverOverlay({ overlayNotificationsEnabled: true, overlayNotifyServerWatcher: false }, 'server-watcher'), false);
  assert.equal(shouldDeliverOverlay({ overlayNotificationsEnabled: true, overlayNotifyServerWatcher: true }, 'server-watcher'), true);

  assert.equal(formatBytesCompact(0), '0 B');
  assert.equal(formatBytesCompact(1536), '1.5 KB');
  assert.equal(formatBytesCompact(5 * 1024 * 1024), '5.0 MB');

  const fallback = await analyzeCrashLogs({});
  assert.equal(fallback.code, 'DESKTOP_REQUIRED');
});
