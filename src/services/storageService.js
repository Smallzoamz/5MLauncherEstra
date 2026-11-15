import { bannerImageUrl } from '../shared/serverMedia.js';
import { DEFAULT_GITHUB_REPO, normalizePatchManifestUrl } from '../shared/patcherConfig.js';
import { SUPABASE_SOCIAL_GATEWAY_URL } from '../shared/supabaseConfig.js';
// Browser-local favorites/preferences only; never trusted as live status.
const STORAGE_KEY_SERVERS = 'fivem_launcher_servers_v3';
const STORAGE_KEY_ACTIVE_ID = 'fivem_launcher_active_server_id_v3';
const STORAGE_KEY_SETTINGS = 'fivem_launcher_settings_v3';
const STORAGE_KEY_EMPTY_DEFAULT_MIGRATED = 'estra_empty_default_migrated_v1';
const STORAGE_KEY_ONBOARDING_GUIDE_SEEN = 'estra_onboarding_guide_seen_v1';
export const DEFAULT_SETTINGS = {
  fivemPath: '', autoClearCacheBeforeLaunch: false, checkMicBeforeLaunch: true,
  requireSteamDiscordBeforeLaunch: false, runOnWindowsStartup: false, preferredAudioDeviceId: 'default',
  screenshotEnabled: true, screenshotHotkey: 'F12', screenshotOnlyInGame: false,
  screenshotPlaySound: true, screenshotDir: '',
  overlayNotificationsEnabled: true, overlayNotifyScreenshot: true,
  overlayNotifyFriendOnline: true, overlayNotifyFriendInGame: true,
  githubRepo: DEFAULT_GITHUB_REPO, socialServerUrl: SUPABASE_SOCIAL_GATEWAY_URL,
  websiteUrl: 'https://estralauncher.vercel.app/',
  discordUrl: 'https://discord.gg/WYjfK6FWgB',
  facebookUrl: 'https://www.facebook.com/estralauncher'
};
export const DEFAULT_SERVERS = [];
function resetLive(s) { return { ...s, favorite: !!s.favorite, directorySlug: typeof s.directorySlug === 'string' ? s.directorySlug : '', customBannerUrl: bannerImageUrl(s.customBannerUrl), bannerUrl: bannerImageUrl(s.bannerUrl), connectingBannerUrl: bannerImageUrl(s.connectingBannerUrl), patchManifestUrl: normalizePatchManifestUrl(s.patchManifestUrl) || '', logoUrl: s.iconSource === 'server-icon-v1' && typeof s.logoUrl === 'string' && s.logoUrl.startsWith('data:image/png;base64,') ? s.logoUrl : null, iconSource: s.iconSource === 'server-icon-v1' ? s.iconSource : null, status: 'Unknown', onlinePlayers: null, maxPlayers: null, ping: null, gameBuild: null, lockPure: null, queryError: null }; }
function isUntouchedFactoryDefaultServer(list) {
  if (!Array.isArray(list) || list.length !== 1) return false;
  const item = list[0];
  return Boolean(
    item &&
    item.id === 'noxtis-legacy' &&
    !String(item.inGameName || '').trim() &&
    !String(item.customBannerUrl || '').trim() &&
    !String(item.patchManifestUrl || '').trim()
  );
}
export function getSavedServers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SERVERS);
    if (!raw) return DEFAULT_SERVERS.map(resetLive);
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return DEFAULT_SERVERS.map(resetLive);
    const migrated = localStorage.getItem(STORAGE_KEY_EMPTY_DEFAULT_MIGRATED);
    if (!migrated) {
      try { localStorage.setItem(STORAGE_KEY_EMPTY_DEFAULT_MIGRATED, '1'); } catch {}
      if (isUntouchedFactoryDefaultServer(list)) {
        try {
          localStorage.setItem(STORAGE_KEY_SERVERS, '[]');
          if (localStorage.getItem(STORAGE_KEY_ACTIVE_ID) === 'noxtis-legacy') {
            localStorage.setItem(STORAGE_KEY_ACTIVE_ID, '');
          }
        } catch {}
        return [];
      }
    }
    const ids = new Set();
    return list.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.ip === 'string' && !ids.has(s.id) && ids.add(s.id)).map(resetLive);
  } catch { return DEFAULT_SERVERS.map(resetLive); }
}
export function saveServers(servers) { localStorage.setItem(STORAGE_KEY_SERVERS, JSON.stringify(servers.map(({ id, name, ip, tag, inGameName, logoUrl, iconSource, bannerUrl, connectingBannerUrl, customBannerUrl, cl2, favorite, patchManifestUrl, directorySlug }) => ({ id, name, ip, tag, inGameName, logoUrl, iconSource, bannerUrl, connectingBannerUrl, customBannerUrl, cl2, favorite: !!favorite, patchManifestUrl: patchManifestUrl || '', directorySlug: directorySlug || '' })))); }
export function getActiveServerId() { try { return localStorage.getItem(STORAGE_KEY_ACTIVE_ID) || ''; } catch { return ''; } }
export function saveActiveServerId(id) { localStorage.setItem(STORAGE_KEY_ACTIVE_ID, id); }
export function hasSeenOnboardingGuide() { try { return localStorage.getItem(STORAGE_KEY_ONBOARDING_GUIDE_SEEN) === '1'; } catch { return true; } }
export function markOnboardingGuideSeen() { try { localStorage.setItem(STORAGE_KEY_ONBOARDING_GUIDE_SEEN, '1'); } catch {} }
export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{}');
    const result = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(result)) if (typeof stored?.[key] === typeof result[key]) result[key] = stored[key];
    if (typeof result.githubRepo === 'string' && result.githubRepo.trim().startsWith('OWNER/')) {
      result.githubRepo = DEFAULT_GITHUB_REPO;
    }
    if (typeof result.socialServerUrl === 'string' && !result.socialServerUrl.trim()) {
      result.socialServerUrl = SUPABASE_SOCIAL_GATEWAY_URL;
    }
    return result;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings) { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); }

