import test from 'node:test';
import assert from 'node:assert/strict';
import { serverIconDataUrl, queryLiveServer } from '../src/server/fivemBackend.js';
import { getSavedServers, saveServers } from '../src/services/storageService.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxXcAAAAASUVORK5CYII=';
test('server icon is validated PNG data, not a URL, SVG or oversized image', () => {
  assert.equal(serverIconDataUrl(png), 'data:image/png;base64,' + png);
  for (const bad of [null, '', '<svg></svg>', 'https://images.test/logo.png', Buffer.from('<svg/>').toString('base64'), 'A'.repeat(350001)]) assert.equal(serverIconDataUrl(bad), null);
  const oversized = Buffer.from(png, 'base64'); oversized.writeUInt32BE(99999, 16);
  assert.equal(serverIconDataUrl(oversized.toString('base64')), null);
});
test('direct server icon wins over banners; absent icon never uses a banner', async () => {
  for (const icon of [png, undefined]) {
    const result = await queryLiveServer('example.com', async url => url.endsWith('dynamic.json') ? { clients: 1 } : { icon, vars: { banner_detail: 'https://example.com/scenery.png' } });
    assert.equal(result.logoUrl, icon ? 'data:image/png;base64,' + png : null);
    assert.equal(result.iconSource, icon ? 'server-icon-v1' : null);
  }
});
test('join code retrieves icon from advertised FiveM endpoint without fetching arbitrary URLs', async () => {
  const calls = [];
  const result = await queryLiveServer('cfx.re/join/abcdef', async url => {
    calls.push(url);
    if (url.includes('/single/')) return { Data: { clients: 1, connectEndPoints: ['https://evil.test/private', 'example.com:30120'] } };
    assert.equal(url, 'http://example.com:30120/info.json'); return { icon: png };
  });
  assert.equal(result.logoUrl, 'data:image/png;base64,' + png);
  assert.equal(calls.length, 2);
});
test('existing favorites migrate away from legacy image URLs without losing user edits', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveServers([{ id: 'my-city', name: 'My name', ip: 'example.com', logoUrl: 'https://imgbob.net/old-scene.png', cl2: true }]);
  let server = getSavedServers()[0];
  assert.equal(server.logoUrl, null); assert.equal(server.name, 'My name'); assert.equal(server.cl2, true);
  saveServers([{ ...server, logoUrl: 'data:image/png;base64,' + png, iconSource: 'server-icon-v1' }]);
  assert.equal(getSavedServers()[0].logoUrl, 'data:image/png;base64,' + png);
});
