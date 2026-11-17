import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDONS_CATALOG, CRP_OVERLAY_ADDON_ID, getAddonCatalogEntry } from '../src/shared/addonsCatalog.js';
import {
  DEFAULT_CRP_CONFIG,
  DEFAULT_QUICK_COMMANDS,
  buildF8MultiCommand,
  buildScheduleAlertPayload,
  computeNextScheduleOccurrence,
  copyCommandText,
  evaluateDueSchedules,
  formatScheduleDaysSummary,
  installCrpOverlayAddon,
  loadCrpAddonState,
  normalizeCrpHotkey,
  normalizeCrpPosition,
  sanitizeCrpConfig,
  saveCrpOverlayConfig,
  uninstallCrpOverlayAddon
} from '../src/services/crpOverlayService.js';
import { shouldDeliverOverlay } from '../src/services/overlayService.js';

async function withMockLocalStorage(fn) {
  const store = new Map();
  const prevStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => { store.set(key, String(val)); },
    removeItem: key => { store.delete(key); }
  };
  try {
    return await fn(store);
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }
}

test('addonsCatalog registers FiveM C-RP-SRP Overlay cleanly', () => {
  assert.equal(ADDONS_CATALOG.length >= 1, true);
  const entry = getAddonCatalogEntry(CRP_OVERLAY_ADDON_ID);
  assert.ok(entry);
  assert.equal(entry.name, 'FiveM C-RP-SRP Overlay');
  assert.equal(entry.defaultHotkey, 'Alt+O');
});

test('buildF8MultiCommand generates semicolon-separated F8 roll commands safely', () => {
  assert.equal(buildF8MultiCommand('roll', 4), 'roll;roll;roll;roll');
  assert.equal(buildF8MultiCommand('roll', 1), 'roll');
  assert.equal(buildF8MultiCommand('/roll', 3), 'roll;roll;roll');
  assert.equal(buildF8MultiCommand('roll', 99), Array(20).fill('roll').join(';'));
  assert.equal(buildF8MultiCommand('roll', 0), 'roll');
  assert.equal(buildF8MultiCommand('  ', 2), 'roll;roll');
});

test('DEFAULT_QUICK_COMMANDS includes reloadmap, reloadskin, and setvoiceintent music/speech', () => {
  const cmds = DEFAULT_QUICK_COMMANDS.map(c => c.command);
  assert.equal(cmds.includes('/reloadmap'), true);
  assert.equal(cmds.includes('/reloadskin'), true);
  assert.equal(cmds.includes('setvoiceintent music'), true);
  assert.equal(cmds.includes('setvoiceintent speech'), true);
});

test('install, config save, and uninstall lifecycle works cleanly in storage', async () => {
  await withMockLocalStorage(async () => {
    const before = await loadCrpAddonState();
    assert.equal(before.installed, false);

    const installed = await installCrpOverlayAddon();
    assert.equal(installed.installed, true);
    assert.equal(installed.config.rollCount, 4);
    assert.equal(installed.config.commands.length, 4);

    const updated = await saveCrpOverlayConfig({
      ...installed.config,
      rollCount: 6,
      toggleHotkey: 'insert',
      position: 'bottom-left'
    });
    assert.equal(updated.config.rollCount, 6);
    assert.equal(updated.config.toggleHotkey, 'Insert');
    assert.equal(updated.config.position, 'bottom-left');

    const reloaded = await loadCrpAddonState();
    assert.equal(reloaded.installed, true);
    assert.equal(reloaded.config.rollCount, 6);

    const removed = await uninstallCrpOverlayAddon();
    assert.equal(removed.installed, false);
    const after = await loadCrpAddonState();
    assert.equal(after.installed, false);
  });
});

test('evaluateDueSchedules triggers pre-reminders across midnight and deduplicates per minute', () => {
  const schedules = [
    {
      id: 'cls-music',
      title: 'วิชาดนตรีและขับร้อง',
      category: 'class',
      scheduleType: 'weekly',
      daysOfWeek: [1], // Monday
      date: '',
      time: '00:05',
      remindBeforeMinutes: 10,
      notifyAtStart: true,
      location: 'ห้อง 204',
      note: 'setvoiceintent music',
      enabled: true
    },
    {
      id: 'evt-once',
      title: 'Event ประจำวัน',
      category: 'event',
      scheduleType: 'once',
      daysOfWeek: [],
      date: '2026-11-16',
      time: '19:30',
      remindBeforeMinutes: 0,
      notifyAtStart: true,
      location: 'ลานกลางเมือง',
      note: '',
      enabled: true
    }
  ];

  // Sunday 2026-11-15 23:55 -> 10 mins before Monday 00:05
  const sunNight = new Date(2026, 10, 15, 23, 55, 12);
  const first = evaluateDueSchedules(schedules, sunNight, new Set());
  assert.equal(first.alerts.length, 1);
  assert.equal(first.alerts[0].phase, 'pre');
  assert.equal(first.alerts[0].payload.kind, 'schedule-alert');
  assert.match(first.alerts[0].payload.badge, /10 นาที/);

  // Same minute should not re-trigger
  const dup = evaluateDueSchedules(schedules, sunNight, first.nextFired);
  assert.equal(dup.alerts.length, 0);

  // Exact start time Monday 2026-11-16 00:05
  const monStart = new Date(2026, 10, 16, 0, 5, 0);
  const startRes = evaluateDueSchedules(schedules, monStart, dup.nextFired);
  assert.equal(startRes.alerts.length, 1);
  assert.equal(startRes.alerts[0].phase, 'start');

  // One-time event on 2026-11-16 19:30
  const evtTime = new Date(2026, 10, 16, 19, 30, 0);
  const evtRes = evaluateDueSchedules(schedules, evtTime, startRes.nextFired);
  assert.equal(evtRes.alerts.length, 1);
  assert.equal(evtRes.alerts[0].payload.title, 'Event ประจำวัน');

  // Next occurrence helper & day summary
  const nextOcc = computeNextScheduleOccurrence(schedules[0], new Date(2026, 10, 15, 23, 50, 0));
  assert.ok(nextOcc);
  assert.equal(nextOcc.minutesUntil, 15);
  assert.equal(formatScheduleDaysSummary(schedules[0]), 'จ · 00:05');

  // Overlay delivery honors schedule-alert kind even when friend alerts are off
  assert.equal(
    shouldDeliverOverlay({ overlayNotificationsEnabled: true, overlayNotifyFriendOnline: false }, 'schedule-alert', false),
    true
  );
  assert.equal(
    shouldDeliverOverlay({ overlayNotificationsEnabled: false }, 'schedule-alert', false),
    false
  );
});

test('crpOverlayService normalizes hotkeys, positions, config, and delegates clipboard to desktop IPC', async () => {
  assert.equal(normalizeCrpHotkey('ctrl + shift + o'), 'Ctrl+Shift+O');
  assert.equal(normalizeCrpHotkey('unknown'), 'Alt+O');
  assert.equal(normalizeCrpPosition('BOTTOM-LEFT'), 'bottom-left');
  assert.equal(normalizeCrpPosition('nope'), 'top-right');

  const clean = sanitizeCrpConfig({ ...DEFAULT_CRP_CONFIG, rollCount: 42, rollCommand: 'roll;quit' });
  assert.equal(clean.rollCount, 20);
  assert.equal(clean.rollCommand, 'roll quit');

  const payload = buildScheduleAlertPayload({ id: 'x', title: 'Test', category: 'event', time: '20:00', remindBeforeMinutes: 5 }, 'pre');
  assert.equal(payload.kind, 'schedule-alert');

  const prevWindow = globalThis.window;
  let copied = '';
  globalThis.window = {
    estraWindow: {
      copyTextToClipboard: async text => {
        copied = text;
      }
    }
  };
  try {
    await copyCommandText('roll;roll;roll;roll');
    assert.equal(copied, 'roll;roll;roll;roll');
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});
