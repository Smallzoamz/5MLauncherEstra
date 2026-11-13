import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isFiveMSessionProcess } from '../src/server/systemPresence.js';
const { createGameSession } = createRequire(import.meta.url)('../desktop/gameSession.cjs');
function fixture() {
  let time = 0, pids = [], callback, error = false;
  const events = [];
  const session = createGameSession({ readSessions: async () => { if (error) throw Error('read failed'); return pids; }, hide: () => events.push('hide'), restore: () => events.push('restore'), status: s => events.push(s), now: () => time, schedule: fn => { callback = fn; return 1; }, cancel: () => { callback = null; } });
  return { session, events, pids: value => { pids = value; }, error: value => { error = value; }, tick: async ms => { time += ms; const fn = callback; callback = null; await fn?.(); } };
}
test('successful launch hides, follows bootstrap replacement, restores after session exits', async () => {
  const f = fixture(); let calls = 0;
  await f.session.launch(async () => { calls++; return { success: true }; });
  assert.equal(calls, 1); assert.deepEqual(f.events, ['hide', 'starting']);
  f.pids([10]); await f.tick(2000); assert.ok(f.events.includes('running'));
  f.pids([]); await f.tick(2000); await f.tick(6000); assert.ok(!f.events.includes('restore'));
  f.pids([11]); await f.tick(2000); assert.ok(!f.events.includes('restore'));
  f.pids([]); await f.tick(2000); await f.tick(12000);
  assert.deepEqual(f.events.slice(-2), ['closed', 'restore']);
});
test('CL2 does not mistake the existing game for a newly launched game', async () => {
  const f = fixture(); f.pids([1]); await f.session.launch(async () => ({}));
  await f.tick(90000); assert.deepEqual(f.events.slice(-2), ['startup-timeout', 'restore']);
  const g = fixture(); g.pids([1]); await g.session.launch(async () => ({}));
  g.pids([1, 2]); await g.tick(2000); g.pids([1]); await g.tick(2000); await g.tick(12000);
  assert.deepEqual(g.events.slice(-2), ['closed', 'restore']);
});
test('dispatch failure never hides; process read failure restores instead of reporting game closed', async () => {
  const f = fixture(); await assert.rejects(f.session.launch(async () => { throw Error('dispatch failure'); }));
  assert.ok(!f.events.includes('hide')); assert.ok(f.events.includes('restore'));
  await f.session.launch(async () => ({})); f.error(true); await f.tick(2000); await f.tick(15000);
  assert.deepEqual(f.events.slice(-2), ['detection-error', 'restore']); assert.ok(!f.events.includes('closed'));
});
test('launch serialization and disposal cancel late async work', async () => {
  const f = fixture(); let release;
  const first = f.session.launch(() => new Promise(r => { release = r; }));
  await assert.rejects(f.session.launch(async () => ({})), e => e.status === 409);
  f.session.dispose(); release({}); await first; await f.tick(100000);
  assert.deepEqual(f.events, []);
});
test('session lifecycle excludes lingering crash/browser/service processes', () => {
  for (const name of ['FiveM.exe', 'FiveM_b3258_GTAProcess.exe', 'FiveM_GTAProcess.exe']) assert.equal(isFiveMSessionProcess(name), true);
  for (const name of ['FiveM_DumpServer.exe', 'FiveM_ChromeBrowser.exe', 'FiveM_ROSLauncher.exe', 'FiveM_ROSService.exe', 'Estra FiveM Launcher.exe']) assert.equal(isFiveMSessionProcess(name), false);
});
test('restored launcher can request CL2 while its first game is running', async () => {
  const f = fixture(); await f.session.launch(async () => ({}));
  f.pids([1]); await f.tick(2000);
  let dispatched = 0; await f.session.launch(async () => { dispatched++; return {}; });
  assert.equal(dispatched, 1);
  f.pids([1, 2]); await f.tick(2000); f.pids([2]); await f.tick(2000); await f.tick(15000);
  assert.ok(!f.events.includes('restore'));
  f.pids([]); await f.tick(2000); await f.tick(12000); assert.ok(f.events.includes('restore'));
});
test('unavailable baseline leaves launcher visible after an allowed CL2 dispatch', async () => {
  const f = fixture(); f.error(true); let dispatched = 0;
  await f.session.launch(async () => { dispatched++; return {}; });
  assert.equal(dispatched, 1); assert.ok(!f.events.includes('hide'));
  assert.deepEqual(f.events, ['detection-error', 'restore']);
});
test('game exits during a subsequent CL2 dispatch: a new monitor accompanies the new hide', async () => {
  const f = fixture(); await f.session.launch(async () => ({})); f.pids([1]); await f.tick(2000);
  let release;
  const next = f.session.launch(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  f.pids([]); await f.tick(2000); await f.tick(12000);
  assert.ok(f.events.includes('restore'));
  release({}); await next;
  assert.equal(f.events.at(-1), 'hide');
  await f.tick(90000);
  assert.deepEqual(f.events.slice(-2), ['startup-timeout', 'restore']);
});
