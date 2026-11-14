import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPublicHost,
  isPublicIpAddress,
  parseFiveMTarget,
  queryFiveMServerForDiscord,
  stripFiveMColors,
} from '../src/services/fivemService.js';

test('parseFiveMTarget handles cfx.re links and ip:port targets', () => {
  assert.deepEqual(parseFiveMTarget('https://cfx.re/join/AbCd12/'), {
    kind: 'join',
    code: 'abcd12',
    address: 'cfx.re/join/abcd12',
  });
  assert.deepEqual(parseFiveMTarget('play.estralcity.gg'), {
    kind: 'direct',
    host: 'play.estralcity.gg',
    port: 30120,
    address: 'play.estralcity.gg:30120',
  });
  assert.throws(() => parseFiveMTarget('192.168.1.999:30120'));
  assert.throws(() => parseFiveMTarget('http://evil.com/path'));
});

test('SSRF defense blocks loopback, private, and cloud metadata addresses', async () => {
  assert.equal(isPublicIpAddress('127.0.0.1'), false);
  assert.equal(isPublicIpAddress('10.0.0.5'), false);
  assert.equal(isPublicIpAddress('172.16.10.2'), false);
  assert.equal(isPublicIpAddress('192.168.1.10'), false);
  assert.equal(isPublicIpAddress('169.254.169.254'), false);
  assert.equal(isPublicIpAddress('::1'), false);
  assert.equal(isPublicIpAddress('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIpAddress('1.1.1.1'), true);

  await assert.rejects(() => assertPublicHost('localhost'));
  await assert.rejects(() => assertPublicHost('metadata.google.internal'));
  await assert.rejects(() => assertPublicHost('internal.example.com', async () => [{ address: '10.10.0.4', family: 4 }]));
});

test('queryFiveMServerForDiscord returns build, pure mode, and stripped hostname', async () => {
  const fetchMock = async url => {
    if (url.includes('/dynamic.json')) {
      return {
        ok: true,
        async text() {
          return JSON.stringify({ hostname: '^4Estra ^7Roleplay ~g~City', clients: 42, sv_maxclients: 128 });
        },
      };
    }
    if (url.includes('/info.json')) {
      return {
        ok: true,
        async text() {
          return JSON.stringify({ vars: { sv_enforceGameBuild: '3095', sv_pureLevel: '0' } });
        },
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const info = await queryFiveMServerForDiscord('play.example.com:30120', {
    fetchImpl: fetchMock,
    lookupImpl: async () => [{ address: '203.0.113.25', family: 4 }],
  });

  assert.equal(info.hostname, 'Estra Roleplay City');
  assert.equal(info.clients, 42);
  assert.equal(info.maxClients, 128);
  assert.equal(info.gameBuild, '3095');
  assert.equal(info.lockPure, 0);
  assert.equal(info.launchArgsPreview, '-b3095 -pure_0 fivem://connect/play.example.com:30120');
});
