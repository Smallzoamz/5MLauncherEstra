import test from 'node:test';
import assert from 'node:assert/strict';
import { getSavedServers, saveServers, getSettings, getActiveServerId, hasSeenOnboardingGuide, markOnboardingGuideSeen } from '../src/services/storageService.js';
import { lookupDirectoryServer, applyDirectoryMetadataToServer, mergeDirectoryEntries } from '../src/shared/serverDirectory.js';
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
  saveServers([{ id:'test', ip:'example.com', name:'Test', status:'Online', onlinePlayers:45 }]);
  const s = getSavedServers()[0]; assert.equal(s.status, 'Unknown'); assert.equal(s.onlinePlayers, null);
  values.set('fivem_launcher_settings_v3', '{"checkMicBeforeLaunch":"yes","runOnWindowsStartup":true}');
  assert.equal(getSettings().checkMicBeforeLaunch, true);
  assert.equal(getSettings().runOnWindowsStartup, true);
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
  assert.equal(synced.server.tag, 'Roleplay');
  assert.equal(synced.server.patchManifestUrl, 'https://cdn.example.com/manifest.json');
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

