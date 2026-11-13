import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchHistory, HISTORY_KEY, HISTORY_LIMIT, latestHistoryCity, findHistoryCity } from '../src/services/launchHistory.js';
import { prepareLaunch } from '../src/services/prepareLaunch.js';
const city = { id: 'a', name: 'เมืองทดสอบ 🔮', ip: 'example.com:30120', cl2: false, inGameName: 'Private Name' };
const memory = () => { const data = new Map(); return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }; };
test('history persists success/failure, caps at 50 and never stores personal launch settings', () => {
  const storage = memory(), history = createLaunchHistory(storage);
  for (let i = 0; i < HISTORY_LIMIT + 3; i++) { const id = history.begin(city); history.finish(id, i % 2 ? 'sent' : 'failed', 'Dispatch failed'); }
  assert.equal(history.getSnapshot().entries.length, HISTORY_LIMIT);
  assert.deepEqual(createLaunchHistory(storage).getSnapshot().entries, history.getSnapshot().entries);
  assert.ok(!storage.getItem(HISTORY_KEY).includes('Private Name'));
  const entry = history.getSnapshot().entries[0]; assert.equal(entry.status, 'failed'); assert.equal(entry.error, 'Dispatch failed');
  history.clear(); assert.deepEqual(createLaunchHistory(storage).getSnapshot().entries, []);
});
test('unfinished launch is unknown after restart; failures never replace last successful dispatch', () => {
  const storage = memory(), history = createLaunchHistory(storage);
  const id = history.begin(city); history.finish(id, 'sent');
  const other = { ...city, id: 'b', ip: 'other.example:30120' };
  history.finish(history.begin(other), 'failed'); history.begin(other);
  const loaded = createLaunchHistory(storage).getSnapshot();
  assert.equal(loaded.entries[0].status, 'interrupted');
  assert.equal(latestHistoryCity(loaded.entries, [city, other]), city);
  assert.equal(latestHistoryCity(loaded.entries, [other]), null);
  assert.equal(latestHistoryCity(loaded.entries, [{ ...city, ip: 'changed.example:30120' }]), null);
  assert.equal(findHistoryCity(loaded.entries[2], [{ ...city, cl2: true }]).cl2, true);
});
test('corrupt history and storage denial are visible and cannot become launch destinations', () => {
  const storage = memory(); storage.setItem(HISTORY_KEY, '{bad');
  assert.ok(createLaunchHistory(storage).getSnapshot().error);
  storage.setItem(HISTORY_KEY, JSON.stringify([null, { id: 'invalid' }]));
  assert.deepEqual(createLaunchHistory(storage).getSnapshot().entries, []);
  const history = createLaunchHistory({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  history.finish(history.begin(city), 'sent'); assert.equal(history.getSnapshot().entries[0].status, 'sent'); assert.ok(history.getSnapshot().error);
  assert.equal(findHistoryCity({ city: { id: city.id, ip: 'bad&command' } }, [city]), null);
});
test('shared launch preflight preserves process, CL2, Name, application, microphone and cache guards', async () => {
  const calls = [];
  let running = false;
  const deps = { installation: async () => calls.push('installation'), presence: async () => ({ fivem: { running }, steam: { running: true }, discord: { running: true } }),
    mic: { startMicStream: async () => { calls.push('mic'); return { success: true }; }, stopMicStream: () => calls.push('stop-mic') },
    cleanCache: async () => { calls.push('cache'); return { success: true }; }, dispatch: async () => { calls.push('dispatch'); return { success: true, message: 'Sent' }; } };
  const settings = { fivemPath: '', checkMicBeforeLaunch: true, autoClearCacheBeforeLaunch: true, requireSteamDiscordBeforeLaunch: true };
  await prepareLaunch(city, settings, deps); assert.deepEqual(calls, ['installation','mic','stop-mic','cache','dispatch']);
  calls.length = 0; running = true;
  await assert.rejects(prepareLaunch(city, settings, deps), /Name/); assert.deepEqual(calls, ['installation']);
  await assert.rejects(prepareLaunch({ ...city, inGameName: '' }, settings, deps), /FiveM กำลังทำงาน/);
  calls.length = 0;
  await prepareLaunch({ ...city, inGameName: '', cl2: true }, settings, deps); assert.deepEqual(calls, ['installation','mic','stop-mic','dispatch']);
  running = false;
  await assert.rejects(prepareLaunch(city, settings, { ...deps, dispatch: async () => ({ success: false, error: 'Failed' }) }), /Failed/);
  await assert.rejects(prepareLaunch(city, settings, { ...deps, cleanCache: async () => ({ success: false, error: 'Cache locked' }) }), /Cache locked/);
});
