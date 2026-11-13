import test from 'node:test';
import assert from 'node:assert/strict';
import { cityBackdrop } from '../src/shared/cityBackdrop.js';
test('missing-banner themes are stable per endpoint, distinct per city and never interpolate untrusted markup', () => {
  const first = cityBackdrop({ ip: '147.50.229.43:30120' });
  assert.equal(first, cityBackdrop({ ip: '147.50.229.43:30120', name: 'Renamed' }));
  assert.notEqual(first, cityBackdrop({ ip: 'join.wizchronicles.com:30120' }));
  assert.ok(!decodeURIComponent(cityBackdrop({ ip: '<script>alert(1)</script>' })).includes('<script>'));
});
