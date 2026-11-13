import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GITHUB_REPO,
  isConfiguredGithubRepo,
  isValidGithubRepo,
  normalizePatchManifestUrl,
  formatBytes
} from '../src/shared/patcherConfig.js';

test('patcher GitHub repo and HTTPS manifest URL validation', () => {
  assert.equal(isValidGithubRepo('estra-team/5MLauncher'), true);
  assert.equal(isValidGithubRepo('bad repo'), false);
  assert.equal(isValidGithubRepo('../escape'), false);
  assert.equal(isConfiguredGithubRepo('OWNER/5MLauncher'), false);
  assert.equal(isConfiguredGithubRepo(DEFAULT_GITHUB_REPO), true);
  assert.equal(isConfiguredGithubRepo('estra-team/5MLauncher'), true);

  assert.equal(normalizePatchManifestUrl(''), '');
  assert.equal(
    normalizePatchManifestUrl('https://raw.githubusercontent.com/estra/repo/main/patch-manifest.json'),
    'https://raw.githubusercontent.com/estra/repo/main/patch-manifest.json'
  );
  assert.equal(normalizePatchManifestUrl('http://example.com/manifest.json'), null);
  assert.equal(normalizePatchManifestUrl('https://user:pass@example.com/manifest.json'), null);
  assert.equal(formatBytes(1536), '1.5 KB');
});
