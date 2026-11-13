import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyPlayerName } from '../src/server/playerName.js';
import { ClassicLevel } from 'classic-level';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = await fs.mkdtemp(path.resolve('tests/artifacts/nickname-browser-'));
const installation = { app: path.join(root, 'FiveM.app'), data: path.join(root, 'FiveM.app/data') };
await fs.mkdir(installation.data, { recursive: true });
const open = () => chromium.launchPersistentContext(installation.data, { headless: true, args: ['--profile-directory=nui-storage'] });
const renameProfile = async (from, to) => {
  const source = path.resolve(installation.data, from), target = path.resolve(installation.data, to);
  for (const value of [source, target]) assert.equal(path.dirname(value), installation.data);
  await fs.rename(source, target);
};
let context = await open();
const page = await context.newPage();
await page.route('https://nui-game-internal/**', route => route.fulfill({ contentType: 'text/html', body: '<title>FiveM Name storage fixture</title>' }));
await page.goto('https://nui-game-internal/ui/app/index.html');
await page.evaluate(() => { localStorage.setItem('nickOverride', 'Before'); localStorage.setItem('unrelated-setting', 'keep exactly'); });
await context.close(); context = null;
// Headless Chromium uses Default; CEF stores this same database at nui-storage.
await renameProfile('Default', 'nui-storage');
const name = 'Sora Kitagawa · ทดสอบ 🔮';
assert.equal((await applyPlayerName(installation, name)).changed, true);
assert.equal((await applyPlayerName(installation, name)).changed, false);
const lock = new ClassicLevel(path.join(installation.data, 'nui-storage/Local Storage/leveldb'), { createIfMissing: false });
await lock.open();
try { await assert.rejects(applyPlayerName(installation, 'While open'), /กำลังใช้ข้อมูล Name|lock/i); }
finally { await lock.close(); }
await renameProfile('nui-storage', 'Default');
context = await open();
try {
  const page = await context.newPage();
  await page.route('https://nui-game-internal/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Read existing settings</title>' }));
  await page.goto('https://nui-game-internal/ui/app/index.html');
  const values = await page.evaluate(() => ({ name: localStorage.getItem('nickOverride'), other: localStorage.getItem('unrelated-setting') }));
  assert.equal(values.name, name); assert.equal(values.other, 'keep exactly');
  const backupFiles = await fs.readdir(path.join(installation.app, 'estra-backups'));
  assert.equal(backupFiles.length, 1);
  const evidence = { chromiumReadsUpdatedName: true, unicode: true, unrelatedPreferencePreserved: true, lockedProfileRejected: true, idempotent: true, previousNameBackedUp: true, actualFiveMProfileModified: false };
  await fs.writeFile('tests/artifacts/nickname-browser-1.6.0.json', JSON.stringify(evidence, null, 2)); console.log(evidence);
} finally { await context.close(); }
