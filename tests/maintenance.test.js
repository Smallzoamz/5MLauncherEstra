import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previewMaintenance, cleanMaintenance } from '../src/server/maintenance.js';
import { resolveInstallation } from '../src/server/fivemBackend.js';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-maintenance-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('estra-maintenance-')); await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, 'FiveM.exe'), 'fixture - never execute');
  for (const file of ['logs/test.log', 'crashes/crash.dmp', 'data/cache/shaders/a.bin', 'data/nui-storage/GPUCache/a.bin', 'data/nui-storage/context-server_123/GPUCache/b.bin', 'data/nui-storage/Local Storage/keep', 'data/nui-storage/IndexedDB/keep', 'data/game-storage/keep', 'data/server-cache/keep', 'CitizenFX.ini']) {
    const target = path.join(root, 'FiveM.app', file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'keep');
  }
  return { root, options: { fivemPath: root }, deps: { getProcessNames: async () => [] }, file: relative => path.join(root, 'FiveM.app', relative) };
}
test('preview counts real files; selected cleanup preserves game files, server cache, preferences and other categories', async t => {
  const f = await fixture(t); const preview = await previewMaintenance(f.options);
  assert.deepEqual(preview.groups.map(g => [g.category, g.files, g.bytes]), [['logs', 1, 4], ['crashes', 1, 4], ['shaders', 3, 12]]);
  const result = await cleanMaintenance({ ...f.options, categories: ['logs', 'shaders'] }, f.deps);
  assert.equal(result.success, true); assert.equal(result.deletedFiles, 4);
  await assert.rejects(fs.access(f.file('logs')));
  for (const file of ['crashes/crash.dmp', 'data/nui-storage/Local Storage/keep', 'data/nui-storage/IndexedDB/keep', 'data/game-storage/keep', 'data/server-cache/keep', 'CitizenFX.ini']) assert.equal(await fs.readFile(f.file(file), 'utf8'), 'keep');
  assert.equal((await cleanMaintenance({ ...f.options, categories: ['logs', 'shaders'] }, f.deps)).deletedFiles, 0);
});
test('game running or unknown process state prevents maintenance deletion', async t => {
  const f = await fixture(t);
  for (const read of [async () => ['FiveM.exe'], async () => { throw Error('tasklist failed'); }]) {
    await assert.rejects(cleanMaintenance({ ...f.options, categories: ['logs', 'crashes', 'shaders'] }, { getProcessNames: read }));
    assert.equal(await fs.readFile(f.file('logs/test.log'), 'utf8'), 'keep');
  }
  for (const categories of [[], ['../'], ['logs', 'logs'], 'logs', ['__proto__']]) await assert.rejects(cleanMaintenance({ ...f.options, categories }, f.deps));
});
test('a junction in any selected target blocks all deletes before the first mutation', async t => {
  const f = await fixture(t); const outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'safe');
  await fs.symlink(outside, f.file('crashes/linked'), 'junction');
  await assert.rejects(cleanMaintenance({ ...f.options, categories: ['logs', 'crashes'] }, f.deps), /junction/);
  assert.equal(await fs.readFile(f.file('logs/test.log'), 'utf8'), 'keep'); assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'safe');
});
test('a game starting during file measurement prevents all deletion', async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(cleanMaintenance({ ...f.options, categories: ['logs'] }, { getProcessNames: async () => ++calls === 1 ? [] : ['FiveM.exe'] }));
  assert.equal(await fs.readFile(f.file('logs/test.log'), 'utf8'), 'keep');
});

test('a relocated installation resolves its entry junction but still rejects links inside cleanup targets', async t => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'relocated-entry');
  await fs.symlink(f.root, alias, 'junction');
  const installation = await resolveInstallation(alias);
  assert.equal(installation.root, await fs.realpath(f.root));
  assert.equal(installation.data, path.join(installation.root, 'FiveM.app', 'data'));
  const options = { fivemPath: alias };
  assert.deepEqual((await previewMaintenance(options)).groups.map(g => g.files), [1, 1, 3]);
  const outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep'), 'safe');
  await fs.symlink(outside, f.file('crashes/linked'), 'junction');
  await assert.rejects(cleanMaintenance({ ...options, categories: ['logs', 'crashes'] }, f.deps), /junction/);
  assert.equal(await fs.readFile(f.file('logs/test.log'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'safe');
  assert.equal((await cleanMaintenance({ ...options, categories: ['logs'] }, f.deps)).deletedFiles, 1);
});
