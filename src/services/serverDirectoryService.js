import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../shared/supabaseConfig';
import {
  DEFAULT_SERVER_DIRECTORY,
  mergeDirectoryEntries,
  normalizeDirectoryEntry
} from '../shared/serverDirectory';

const STORAGE_KEY_SERVER_DIRECTORY = 'estra_server_directory_v1';

export function loadCachedServerDirectory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SERVER_DIRECTORY);
    if (!raw) return DEFAULT_SERVER_DIRECTORY;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SERVER_DIRECTORY;
    return mergeDirectoryEntries(parsed, DEFAULT_SERVER_DIRECTORY);
  } catch {
    return DEFAULT_SERVER_DIRECTORY;
  }
}

export async function fetchServerDirectory({ signal } = {}) {
  const cached = loadCachedServerDirectory();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });

  try {
    const endpoint =
      `${SUPABASE_URL}/rest/v1/launcher_server_directory` +
      '?select=slug,canonical_name,primary_address,aliases,tag,patch_manifest_url,custom_banner_url,sort_order' +
      '&is_active=eq.true&order=sort_order.asc,canonical_name.asc';

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) return cached;
    const rows = await response.json();
    if (!Array.isArray(rows)) return cached;

    const normalized = rows.map(normalizeDirectoryEntry).filter(Boolean);
    const merged = mergeDirectoryEntries(normalized, DEFAULT_SERVER_DIRECTORY);
    try {
      localStorage.setItem(STORAGE_KEY_SERVER_DIRECTORY, JSON.stringify(normalized));
    } catch {}
    return merged;
  } catch {
    return cached;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
