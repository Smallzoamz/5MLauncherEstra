import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTelemetryLabels, updateTelemetryChannelIfDue } from '../src/services/releaseWatcher.js';
import { fetchEstraTelemetry, verifyReleaseSha256 } from '../src/services/telemetryService.js';
import { BotStore } from '../src/store/sqliteStore.js';

const SAMPLE_SHA = '6be81d4278f91c13ec94f6e505cdb662c568059d41470708fab29a8132e7d02b';

test('fetchEstraTelemetry falls back to GitHub releases when Vercel telemetry fails', async () => {
  const fetchMock = async url => {
    if (url.includes('estralauncher.vercel.app')) {
      return { ok: false, status: 503 };
    }
    return {
      ok: true,
      async json() {
        return [
          {
            tag_name: 'v2.1.7',
            name: 'Estra v2.1.7',
            published_at: '2026-11-14T19:21:57Z',
            body: 'Release notes',
            assets: [
              {
                name: 'Estra.FiveM.Launcher_2.1.7_x64-setup.exe',
                size: 7292565,
                download_count: 25,
                digest: `sha256:${SAMPLE_SHA}`,
              },
            ],
          },
        ];
      },
    };
  };

  const telemetry = await fetchEstraTelemetry({
    telemetryApiUrl: 'https://estralauncher.vercel.app/api/stats',
    githubRepo: 'Smallzoamz/5MLauncherEstra',
    fetchImpl: fetchMock,
  });

  assert.equal(telemetry.source, 'github-fallback');
  assert.equal(telemetry.latest.tag, 'v2.1.7');
  assert.equal(telemetry.latest.sha256, SAMPLE_SHA);
  assert.equal(telemetry.downloads.total, 25);
});

test('verifyReleaseSha256 validates format, match, and version mismatch', () => {
  const telemetry = {
    latest: { tag: 'v2.1.7', version: '2.1.7', sha256: SAMPLE_SHA },
    releases: [
      { tag: 'v2.1.6', version: '2.1.6', sha256: 'a'.repeat(64), assetName: 'v216.exe', size: 100 },
      { tag: 'v2.1.7', version: '2.1.7', sha256: SAMPLE_SHA, assetName: 'v217.exe', size: 200 },
    ],
  };

  const invalid = verifyReleaseSha256('not-a-hash', telemetry);
  assert.equal(invalid.validFormat, false);

  const exact = verifyReleaseSha256(`SHA256:${SAMPLE_SHA.toUpperCase()}`, telemetry, '2.1.7');
  assert.equal(exact.validFormat, true);
  assert.equal(exact.matched, true);
  assert.equal(exact.isLatest, true);
  assert.equal(exact.versionMatch, true);

  const oldVerMismatch = verifyReleaseSha256('a'.repeat(64), telemetry, '2.1.7');
  assert.equal(oldVerMismatch.matched, true);
  assert.equal(oldVerMismatch.isLatest, false);
  assert.equal(oldVerMismatch.versionMatch, false);

  const unknown = verifyReleaseSha256('f'.repeat(64), telemetry);
  assert.equal(unknown.validFormat, true);
  assert.equal(unknown.matched, false);
});

test('updateTelemetryChannelIfDue enforces cooldown and avoids redundant renames', async () => {
  const store = new BotStore(':memory:');
  try {
    let renameCount = 0;
    const fakeChannel = {
      name: '🟢 ออนไลน์: — | ในเมือง: —',
      async setName(name) {
        this.name = name;
        renameCount += 1;
      },
    };
    const fakeGuild = {
      id: 'guild-1',
      channels: { async fetch() { return fakeChannel; } },
      members: { async fetchMe() { return { permissionsIn: () => ({ has: () => true }) }; } },
    };

    const labels1 = formatTelemetryLabels({ users: { online: 3, inGame: 1 }, downloads: { total: 40 } });
    const r1 = await updateTelemetryChannelIfDue(fakeGuild, store, 'ch-online', 'online', labels1.onlineLabel, 660_000, 1_000_000);
    assert.equal(r1.status, 'renamed');
    assert.equal(renameCount, 1);

    // Same label -> unchanged
    const r2 = await updateTelemetryChannelIfDue(fakeGuild, store, 'ch-online', 'online', labels1.onlineLabel, 660_000, 1_010_000);
    assert.equal(r2.status, 'unchanged');

    // Different label within cooldown -> blocked by cooldown
    const labels2 = formatTelemetryLabels({ users: { online: 4, inGame: 2 }, downloads: { total: 41 } });
    const r3 = await updateTelemetryChannelIfDue(fakeGuild, store, 'ch-online', 'online', labels2.onlineLabel, 660_000, 1_100_000);
    assert.equal(r3.status, 'cooldown');
    assert.equal(renameCount, 1);

    // After cooldown expires -> renames cleanly
    const r4 = await updateTelemetryChannelIfDue(fakeGuild, store, 'ch-online', 'online', labels2.onlineLabel, 660_000, 1_700_000);
    assert.equal(r4.status, 'renamed');
    assert.equal(renameCount, 2);
  } finally {
    store.close();
  }
});
