import { parseTarget } from './target.js';
import { DEFAULT_SERVER_TAG, normalizeServerTag } from './serverTags.js';

export const DEFAULT_SERVER_DIRECTORY = [
  {
    slug: 'noxtis-legacy',
    name: 'Noxtis Legacy',
    address: '89.38.101.136:30120',
    aliases: ['89.38.101.136:30120'],
    tag: DEFAULT_SERVER_TAG,
    patchManifestUrl: '',
    customBannerUrl: '',
    sortOrder: 10
  }
];

function safeHttpUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function normalizeDirectoryAddress(raw) {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return null;
  try {
    return parseTarget(input).address;
  } catch {
    return null;
  }
}

export function normalizeDirectoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.canonical_name ?? raw.name ?? '').trim().slice(0, 100);
  const address = normalizeDirectoryAddress(raw.primary_address ?? raw.address ?? raw.ip ?? '');
  if (!name || !address) return null;

  const aliasSet = new Set([address]);
  const rawAliases = Array.isArray(raw.aliases) ? raw.aliases : [];
  for (const item of rawAliases) {
    const normalized = normalizeDirectoryAddress(item);
    if (normalized) aliasSet.add(normalized);
  }

  const tag = normalizeServerTag(raw.tag, DEFAULT_SERVER_TAG);
  const slug = String(raw.slug || address).trim().slice(0, 100) || address;
  const sortOrder = Number.isFinite(Number(raw.sort_order ?? raw.sortOrder))
    ? Number(raw.sort_order ?? raw.sortOrder)
    : 100;

  return {
    slug,
    name,
    address,
    aliases: Array.from(aliasSet),
    tag,
    patchManifestUrl: safeHttpUrl(raw.patch_manifest_url ?? raw.patchManifestUrl),
    customBannerUrl: safeHttpUrl(raw.custom_banner_url ?? raw.customBannerUrl),
    sortOrder
  };
}

export function mergeDirectoryEntries(primaryList, fallbackList = DEFAULT_SERVER_DIRECTORY) {
  const byAddress = new Map();
  for (const raw of Array.isArray(fallbackList) ? fallbackList : []) {
    const entry = normalizeDirectoryEntry(raw);
    if (entry) byAddress.set(entry.address, entry);
  }
  for (const raw of Array.isArray(primaryList) ? primaryList : []) {
    const entry = normalizeDirectoryEntry(raw);
    if (entry) byAddress.set(entry.address, entry);
  }
  return Array.from(byAddress.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function lookupDirectoryServer(rawTarget, directory = DEFAULT_SERVER_DIRECTORY) {
  const normalizedAddress = normalizeDirectoryAddress(rawTarget);
  if (!normalizedAddress) return null;
  const entries = Array.isArray(directory) ? directory : DEFAULT_SERVER_DIRECTORY;
  for (const raw of entries) {
    const entry = raw?.aliases && raw?.address ? raw : normalizeDirectoryEntry(raw);
    if (!entry) continue;
    if (entry.address === normalizedAddress || entry.aliases.includes(normalizedAddress)) {
      return { ...entry, normalizedAddress };
    }
  }
  return null;
}

export function applyDirectoryMetadataToServer(server, directory) {
  if (!server || typeof server !== 'object') return { changed: false, server };
  const matched = lookupDirectoryServer(server.ip, directory);
  if (!matched) return { changed: false, server };

  const nextName = matched.name;
  const nextTag = normalizeServerTag(matched.tag || server.tag, DEFAULT_SERVER_TAG);
  const nextPatchManifestUrl = server.patchManifestUrl || matched.patchManifestUrl || '';
  const nextCustomBannerUrl = server.customBannerUrl || matched.customBannerUrl || '';
  const nextSlug = matched.slug;

  const changed =
    server.name !== nextName ||
    server.tag !== nextTag ||
    (server.patchManifestUrl || '') !== nextPatchManifestUrl ||
    (server.customBannerUrl || '') !== nextCustomBannerUrl ||
    (server.directorySlug || '') !== nextSlug;

  if (!changed) return { changed: false, server };
  return {
    changed: true,
    server: {
      ...server,
      name: nextName,
      tag: nextTag,
      patchManifestUrl: nextPatchManifestUrl,
      customBannerUrl: nextCustomBannerUrl,
      directorySlug: nextSlug
    }
  };
}

export function cleanFiveMServerName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\^[0-9*_=~]/g, '')
    .replace(/~n~/gi, ' ')
    .replace(/~[a-zA-Z]{1,6}~/g, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function pickFetchedServerName(info, fallbackAddress = '') {
  if (!info || typeof info !== 'object') return '';
  const fallback = String(fallbackAddress || '').trim().toLowerCase();
  const candidates = [info.projectName, info.hostname];
  for (const raw of candidates) {
    const cleaned = cleanFiveMServerName(raw);
    if (!cleaned) continue;
    if (fallback && cleaned.toLowerCase() === fallback) continue;
    return cleaned;
  }
  return '';
}

export function syncLiveServerName(server, liveInfo, directory = DEFAULT_SERVER_DIRECTORY) {
  const currentName = typeof server?.name === 'string' ? server.name : '';
  const prevFetched = typeof server?.lastFetchedName === 'string' ? server.lastFetchedName.trim() : '';
  if (!server || !liveInfo?.online) {
    return { name: currentName, lastFetchedName: prevFetched };
  }
  if (lookupDirectoryServer(server.ip, directory)) {
    return { name: currentName, lastFetchedName: prevFetched };
  }
  const liveName = pickFetchedServerName(liveInfo, server.ip);
  if (!liveName) {
    return { name: currentName, lastFetchedName: prevFetched };
  }
  if (!prevFetched || liveName !== prevFetched) {
    return { name: liveName, lastFetchedName: liveName };
  }
  return { name: currentName, lastFetchedName: prevFetched };
}
