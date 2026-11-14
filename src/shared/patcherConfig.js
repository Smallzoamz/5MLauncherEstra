export const DEFAULT_GITHUB_REPO = 'Smallzoamz/5MLauncherEstra';
export const APP_VERSION = typeof __ESTRA_APP_VERSION__ !== 'undefined' ? __ESTRA_APP_VERSION__ : '2.1.7';

export function isValidGithubRepo(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed) && !trimmed.includes('..');
}

export function isConfiguredGithubRepo(value) {
  return isValidGithubRepo(value) && !value.trim().startsWith('OWNER/');
}

export function normalizePatchManifestUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2048 || /[\x00-\x1f]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const PATCH_MANIFEST_TEMPLATE = JSON.stringify({
  version: '1.0.0',
  name: 'Estra City Patch',
  notes: '- อัปเดตไฟล์เสียงและเมนูในเมือง\n- แก้ไขไฟล์คอนฟิกหลัก',
  publishedAt: '2026-11-13T12:00:00Z',
  files: [
    {
      path: 'citizen/common/data/example.meta',
      url: 'https://github.com/OWNER/REPO/releases/download/patch-1.0.0/example.meta',
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      size: 1024
    }
  ]
}, null, 2);
