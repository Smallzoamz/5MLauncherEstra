import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseGatewayUrl } from '../shared/supabaseConfig.js';

let memoryClient = null;

function getMemorySupabaseClient() {
  if (!memoryClient) {
    // Keep Realtime auth strictly in memory; never persist tokens in localStorage.
    memoryClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        detectSessionInUrl: false,
        autoRefreshToken: false
      }
    });
  }
  return memoryClient;
}

export function subscribeSocialRealtime({ accessToken, userId, socialServerUrl, onChange }) {
  if (!accessToken || !userId || !isSupabaseGatewayUrl(socialServerUrl) || typeof onChange !== 'function') {
    return () => {};
  }

  const client = getMemorySupabaseClient();
  client.realtime.setAuth(accessToken);

  let timer = null;
  const triggerRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onChange();
    }, 250);
  };

  const channel = client
    .channel(`launcher-social-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_profiles' }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_friendships', filter: `user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_friend_requests', filter: `to_user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_friend_requests', filter: `from_user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_favorite_servers', filter: `user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_game_invites', filter: `to_user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_game_invites', filter: `from_user_id=eq.${userId}` }, triggerRefresh)
    .subscribe();

  return () => {
    clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
