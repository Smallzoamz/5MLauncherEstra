export const SUPABASE_URL = 'https://hcynletyqztbbouwlcsg.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_puj9yz5BQ_i3DEmhnpgmww_4fifPu5e';
export const SUPABASE_SOCIAL_GATEWAY_URL = `${SUPABASE_URL}/functions/v1/social-gateway`;
export const LOCAL_SOCIAL_SENTINEL = 'local';

export function resolveSocialServerUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return SUPABASE_SOCIAL_GATEWAY_URL;
  if (value.toLowerCase() === LOCAL_SOCIAL_SENTINEL) return '';
  return value;
}

export function isSupabaseGatewayUrl(url) {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.origin === SUPABASE_URL && parsed.pathname.startsWith('/functions/v1/');
  } catch {
    return false;
  }
}
