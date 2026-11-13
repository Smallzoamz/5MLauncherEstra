const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ClassicLevel } = require('classic-level');
(async () => {
  const root = await fs.mkdtemp(path.resolve('tests/artifacts/packaged-name-'));
  const installation = { app: path.join(root, 'FiveM.app'), data: path.join(root, 'FiveM.app/data') };
  const dbPath = path.join(installation.data, 'nui-storage/Local Storage/leveldb');
  const key = Buffer.from('_https://nui-game-internal\x00\x01nickOverride');
  const db = new ClassicLevel(dbPath, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db.batch([{ type: 'put', key: Buffer.from('VERSION'), value: Buffer.from('1') }, { type: 'put', key, value: Buffer.from('\x01Old') }, { type: 'put', key: Buffer.from('META:https://nui-game-internal'), value: Buffer.from([8, 0, 16, 32]) }]); await db.close();
  const env = { ...process.env, LAUNCHER_TEST_USER_DATA: path.resolve('tests/artifacts/release16-profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: process.env.LAUNCHER_PACKAGED_EXE, args: [], env });
  try {
    const page = await app.firstWindow(); await page.waitForURL('launcher://app/'); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const changed = await app.evaluate(async ({ app }, installation) => {
      const { applyPlayerName } = process.mainModule.require(app.getAppPath() + '/src/server/playerName.js');
      return applyPlayerName(installation, 'Sora Kitagawa · ทดสอบ');
    }, installation);
    assert.equal(changed.changed, true);
    const read = new ClassicLevel(dbPath, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
    const stored = await read.get(key); assert.equal(stored[0], 0); assert.equal(stored.subarray(1).toString('utf16le'), 'Sora Kitagawa · ทดสอบ'); await read.close();
    const presence = await page.evaluate(async () => (await fetch('/api/system-presence')).json());
    for (const key of ['steam', 'discord']) {
      assert.ok(presence[key].user?.displayName);
      await page.locator(`[data-account="${key}"]`).getByText(presence[key].user.displayName, { exact: true }).waitFor();
      await page.waitForFunction(key => document.querySelector(`[data-account="${key}"] img`)?.naturalWidth > 0, key);
    }
    assert.equal(await page.evaluate(async () => (await fetch('/api/clean-maintenance', { method: 'POST' })).status), 403);
    const preview = await page.evaluate(async () => (await fetch('/api/maintenance-preview')).json());
    assert.ok(Array.isArray(preview.groups), preview.error || 'Maintenance preview must return groups');
    assert.equal(preview.groups.length, 3);
    await page.screenshot({ path: 'tests/artifacts/packaged-profiles-1.6.0.png' });
    assert.deepEqual(errors, []);
    const evidence = { packagedNativeDatabaseWorks: true, unicodeNameWrittenToFixture: true, steamName: presence.steam.user.displayName, discordName: presence.discord.user.displayName, actualAvatarsLoaded: true, maintenanceUnauthorized: 403, livePreview: preview.groups.map(({ category, files, bytes }) => ({ category, files, bytes })), actualFiveMNameModified: false, liveFilesDeleted: false, pageErrors: errors };
    await fs.writeFile('tests/artifacts/packaged-release16.json', JSON.stringify(evidence, null, 2)); console.log(evidence);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });
