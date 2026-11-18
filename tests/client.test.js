import test from 'node:test';
import assert from 'node:assert/strict';
import { getSavedServers, saveServers, getSettings, saveSettings, getActiveServerId, saveActiveServerId, claimLegacyServersOnce, resetLive, hasSeenOnboardingGuide, markOnboardingGuideSeen } from '../src/services/storageService.js';
import { buildServersSyncSignature, mergeCloudServersWithLocalCache } from '../src/shared/userServersSync.js';
import { diffCalendarDuration, formatDetailedDurationThai, formatOfflineDurationLabel, formatPlaytimeSteam, formatLastPlayedLabel } from '../src/shared/durationFormat.js';
import { lookupDirectoryServer, applyDirectoryMetadataToServer, mergeDirectoryEntries, cleanFiveMServerName, pickFetchedServerName, syncLiveServerName } from '../src/shared/serverDirectory.js';
import { SERVER_TAGS, CATEGORY_TAGS, DEFAULT_SERVER_TAG, normalizeServerTag } from '../src/shared/serverTags.js';
import { queryServerInfo, launchFiveM } from '../src/services/fivemService.js';
import audioService from '../src/services/audioService.js';

test('storage recovers malformed data, starts empty, migrates untouched legacy default, strips cached live status', () => {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v) } });
  values.set('fivem_launcher_servers_v3', '{');
  assert.deepEqual(getSavedServers(), []);
  values.set('fivem_launcher_servers_v3', '{}'); assert.deepEqual(getSavedServers(), []);
  values.set('fivem_launcher_servers_v3', JSON.stringify([{ id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120', inGameName: '', customBannerUrl: '', patchManifestUrl: '' }]));
  assert.deepEqual(getSavedServers(), []);
  values.set('fivem_launcher_servers_v3', '[]'); assert.deepEqual(getSavedServers(), []);
  values.delete('estra_empty_default_migrated_v1');
  values.set('fivem_launcher_servers_v3', JSON.stringify([{ id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120', inGameName: 'Custom RP Name' }]));
  assert.equal(getSavedServers().length, 1);
  saveServers([{ id:'test', ip:'example.com', name:'Test', lastFetchedName:'Test', status:'Online', onlinePlayers:45 }]);
  const s = getSavedServers()[0]; assert.equal(s.status, 'Unknown'); assert.equal(s.onlinePlayers, null); assert.equal(s.lastFetchedName, 'Test');
  values.set('fivem_launcher_settings_v3', '{"checkMicBeforeLaunch":"yes","runOnWindowsStartup":true,"discordUrl":"https://discord.gg/e75HXk59EE","facebookUrl":"https://www.facebook.com/ohm.noxoradev"}');
  assert.equal(getSettings().checkMicBeforeLaunch, true);
  assert.equal(getSettings().runOnWindowsStartup, true);
  assert.equal(getSettings().discordUrl, 'https://discord.gg/WYjfK6FWgB');
  assert.equal(getSettings().facebookUrl, 'https://www.facebook.com/estralauncher');
  assert.equal(hasSeenOnboardingGuide(), false);
  markOnboardingGuideSeen();
  assert.equal(hasSeenOnboardingGuide(), true);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
  assert.equal(getActiveServerId(), ''); assert.deepEqual(getSavedServers(), []); assert.equal(getSettings().fivemPath, ''); assert.equal(getSettings().runOnWindowsStartup, false);
  assert.equal(hasSeenOnboardingGuide(), true);
});
test('server directory resolves connect commands, aliases, and syncs canonical metadata', () => {
  const directory = mergeDirectoryEntries([
    {
      slug: 'estra-city',
      canonical_name: 'Estra Roleplay',
      primary_address: 'play.estracity.gg:30120',
      aliases: ['cfx.re/join/abc123', '103.10.20.30'],
      tag: 'Roleplay',
      patch_manifest_url: 'https://cdn.example.com/manifest.json'
    }
  ]);
  const byConnect = lookupDirectoryServer('connect play.estracity.gg', directory);
  assert.equal(byConnect?.name, 'Estra Roleplay');
  assert.equal(byConnect?.normalizedAddress, 'play.estracity.gg:30120');
  const byAlias = lookupDirectoryServer('https://cfx.re/join/ABC123/', directory);
  assert.equal(byAlias?.name, 'Estra Roleplay');
  const synced = applyDirectoryMetadataToServer({ id: '1', name: 'Old Custom Name', ip: '103.10.20.30:30120', tag: 'Training', patchManifestUrl: '' }, directory);
  assert.equal(synced.changed, true);
  assert.equal(synced.server.name, 'Estra Roleplay');
  assert.equal(synced.server.tag, 'RP');
  assert.equal(synced.server.patchManifestUrl, 'https://cdn.example.com/manifest.json');
  assert.deepEqual(CATEGORY_TAGS, ['RP', 'SRP', 'RP Commu', 'Commu', 'Training', 'School']);
  assert.deepEqual(SERVER_TAGS, ['ไม่มี', 'RP', 'SRP', 'RP Commu', 'Commu', 'Training', 'School']);
  assert.equal(DEFAULT_SERVER_TAG, 'RP');
  assert.equal(normalizeServerTag('Roleplay'), 'RP');
  assert.equal(normalizeServerTag('RP Commu'), 'RP Commu');
  assert.equal(normalizeServerTag('School'), 'School');
  assert.equal(normalizeServerTag('UnknownTag'), 'RP');
});
test('cleanFiveMServerName and pickFetchedServerName sanitize color tags and prefer sv_projectName', () => {
  assert.equal(cleanFiveMServerName('^1[TH]^7 ^4Estra   Roleplay^0 ~r~18+~s~'), '[TH] Estra Roleplay 18+');
  assert.equal(
    pickFetchedServerName(
      { projectName: '^4Estra City^0', hostname: '^1[TH]^7 Long Promo Name ^2discord.gg/x' },
      '103.10.20.30:30120'
    ),
    'Estra City'
  );
  assert.equal(
    pickFetchedServerName(
      { projectName: '', hostname: '^2Bangkok Town^7' },
      '103.10.20.30:30120'
    ),
    'Bangkok Town'
  );
  assert.equal(
    pickFetchedServerName(
      { projectName: null, hostname: '103.10.20.30:30120' },
      '103.10.20.30:30120'
    ),
    ''
  );
  // Server offline keeps saved name unchanged
  assert.deepEqual(
    syncLiveServerName({ id: '2', ip: '103.10.20.30:30120', name: 'City V1', lastFetchedName: 'City V1' }, { online: false }, []),
    { name: 'City V1', lastFetchedName: 'City V1' }
  );
  // Same live name preserves manual nickname edit
  assert.deepEqual(
    syncLiveServerName({ id: '2', ip: '103.10.20.30:30120', name: 'My Nickname', lastFetchedName: 'City V1' }, { online: true, projectName: '^2City V1^0' }, []),
    { name: 'My Nickname', lastFetchedName: 'City V1' }
  );
  // Live server changes name -> updates saved name automatically
  assert.deepEqual(
    syncLiveServerName({ id: '2', ip: '103.10.20.30:30120', name: 'My Nickname', lastFetchedName: 'City V1' }, { online: true, projectName: '^4City V2' }, []),
    { name: 'City V2', lastFetchedName: 'City V2' }
  );
  // Directory server keeps canonical directory name
  assert.deepEqual(
    syncLiveServerName({ id: '3', ip: '89.38.101.136:30120', name: 'Noxtis Legacy', lastFetchedName: '' }, { online: true, projectName: 'Other Name' }),
    { name: 'Noxtis Legacy', lastFetchedName: '' }
  );
});
test('client query network failure never falls back to online', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('disconnected'); };
  try { const s = await queryServerInfo({ ip:'host', status:'Online', onlinePlayers:10 }); assert.equal(s.online, false); assert.equal(s.clients, null); }
  finally { globalThis.fetch = original; }
});
test('client launch checks HTTP result, sends selected path, no browser protocol fallback', async () => {
  const original = globalThis.fetch; let posts = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/session') return new Response(JSON.stringify({ token:'test' }));
    posts++; const body = JSON.parse(options.body);
    assert.equal(body.fivemPath, 'C:/My FiveM'); assert.equal(body.cl2, true);
    return new Response(JSON.stringify({ success:false, error:'cannot start' }), { status:400 });
  };
  try { await assert.rejects(launchFiveM({ ip:'host',cl2:true }, { fivemPath:'C:/My FiveM' }), /cannot start/); assert.equal(posts,1); }
  finally { globalThis.fetch = original; }
});
test('enumerating devices never requests microphone permission', async () => {
  let requests = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ mediaDevices:{
    enumerateDevices: async () => [{ kind:'audioinput',label:'',deviceId:'default' }],
    getUserMedia: async () => { requests++; }
  } } });
  assert.equal((await audioService.getInputDevices()).length,1); assert.equal(requests,0);
});
test('closing while microphone permission is pending stops late stream and resets loopback', async () => {
  let resolveStream, stopped = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ mediaDevices:{ getUserMedia: () => new Promise(resolve => { resolveStream = resolve; }) } } });
  audioService.isLoopbackActive = true;
  const pending = audioService.startMicStream();
  audioService.stopMicStream();
  resolveStream({ getTracks:() => [{stop:() => stopped++}] });
  assert.equal((await pending).success,false); assert.equal(stopped,1); assert.equal(audioService.mediaStream,null); assert.equal(audioService.isLoopbackActive,false);
});
test('switching devices cancels older requests without adopting old streams', async () => {
  const resolvers=[]; let stopped=0;
  Object.defineProperty(globalThis,'navigator',{ configurable:true,value:{ mediaDevices:{ getUserMedia:() => new Promise(resolve => resolvers.push(resolve)) } } });
  const first=audioService.startMicStream('one'); const second=audioService.startMicStream('two');
  audioService.stopMicStream();
  for (const resolve of resolvers) resolve({getTracks:() => [{stop:()=>stopped++}]});
  assert.equal((await first).success,false); assert.equal((await second).success,false); assert.equal(stopped,2);
});

test('per-user storage isolates servers & server settings across users, claims legacy once, and keeps program settings local', () => {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: k => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, String(v)),
      removeItem: k => values.delete(k)
    }
  });

  // Program/machine settings stay local regardless of logged-in user
  saveSettings({ ...getSettings(), fivemPath: 'D:\\Games\\FiveM.exe', perfOverlayEnabled: true });

  // Legacy anonymous servers exist before login
  saveServers([{ id: 'legacy-1', name: 'Legacy RP', ip: '1.1.1.1:30120', tag: 'RP', inGameName: 'LegacyChar' }]);
  saveActiveServerId('legacy-1');

  // First user claims legacy servers once and clears legacy keys so user-2 never sees them
  const claimedByUser1 = claimLegacyServersOnce();
  assert.equal(claimedByUser1?.servers.length, 1);
  assert.equal(claimedByUser1?.activeServerId, 'legacy-1');
  assert.equal(claimLegacyServersOnce(), null);
  assert.deepEqual(getSavedServers('user-2'), []);
  assert.equal(getActiveServerId('user-2'), '');

  // Separate user server caches & merge with cloud data preserving local icon cache only
  saveServers([{ id: 'city-a', name: 'Local Cache', ip: '2.2.2.2:30120', logoUrl: 'data:image/png;base64,QUJD', iconSource: 'server-icon-v1' }], 'user-1');
  saveActiveServerId('city-a', 'user-1');
  saveServers([{ id: 'city-b', name: 'User Two City', ip: '3.3.3.3:30120', tag: 'SRP' }], 'user-2');
  saveActiveServerId('city-b', 'user-2');

  assert.equal(getSavedServers('user-1')[0].id, 'city-a');
  assert.equal(getSavedServers('user-2')[0].id, 'city-b');
  assert.equal(getActiveServerId('user-1'), 'city-a');
  assert.equal(getActiveServerId('user-2'), 'city-b');

  const merged = mergeCloudServersWithLocalCache(
    [{ id: 'city-a', name: 'Cloud Renamed', ip: '2.2.2.2:30120', tag: 'Commu', inGameName: 'CloudName', cl2: true, favorite: true, customBannerUrl: 'https://cdn.example.com/banner.jpg' }],
    getSavedServers('user-1'),
    resetLive
  );
  assert.equal(merged[0].name, 'Cloud Renamed');
  assert.equal(merged[0].inGameName, 'CloudName');
  assert.equal(merged[0].cl2, true);
  assert.equal(merged[0].favorite, true);
  assert.equal(merged[0].logoUrl, 'data:image/png;base64,QUJD');

  // Ephemeral live status/icon never alters sync signature
  const sigA = buildServersSyncSignature(merged, 'city-a');
  const sigB = buildServersSyncSignature([{ ...merged[0], onlinePlayers: 99, status: 'Online', logoUrl: 'data:image/png;base64,WFlZ' }], 'city-a');
  assert.equal(sigA, sigB);

  // Local machine settings remain intact after user operations
  assert.equal(getSettings().fivemPath, 'D:\\Games\\FiveM.exe');
  assert.equal(getSettings().perfOverlayEnabled, true);
});

test('durationFormat computes year/month/day/hour/minute offline durations and Steam-style playtime', () => {
  const start = new Date(2025, 0, 15, 10, 20, 0).getTime();
  const end = new Date(2026, 2, 18, 13, 35, 0).getTime();
  const diff = diffCalendarDuration(start, end);
  assert.equal(diff.years, 1);
  assert.equal(diff.months, 2);
  assert.equal(diff.days, 3);
  assert.equal(diff.hours, 3);
  assert.equal(diff.minutes, 15);
  assert.equal(formatDetailedDurationThai(start, end), '1 ปี 2 เดือน 3 วัน 3 ชั่วโมง 15 นาที');
  assert.equal(formatOfflineDurationLabel(start, end), 'ออฟไลน์มาแล้ว 1 ปี 2 เดือน 3 วัน 3 ชั่วโมง 15 นาที');
  assert.equal(formatOfflineDurationLabel(end - 25_000, end), 'ออฟไลน์มาแล้ว ไม่ถึง 1 นาที');
  assert.equal(formatOfflineDurationLabel(null, end), 'ออฟไลน์');

  assert.equal(formatPlaytimeSteam(0).short, 'ยังไม่เคยเล่น');
  assert.equal(formatPlaytimeSteam(45).short, 'น้อยกว่า 1 นาที');
  assert.equal(formatPlaytimeSteam(1800).short, '30 นาที');
  assert.equal(formatPlaytimeSteam(5400).short, '1.5 ชม.');
  assert.equal(formatPlaytimeSteam(5400).full, '1 ชั่วโมง 30 นาที');
  assert.equal(formatPlaytimeSteam(370_800).short, '103 ชม.');

  assert.equal(formatLastPlayedLabel(start, true, end), 'กำลังเล่นอยู่ในขณะนี้');
  assert.equal(formatLastPlayedLabel(null, false, end), 'ยังไม่เคยเข้าเมืองนี้');
  assert.match(formatLastPlayedLabel(start, false, end), /^เล่นล่าสุด 1 ปี 2 เดือน 3 วัน 3 ชั่วโมง 15 นาที ที่แล้ว$/);
});



