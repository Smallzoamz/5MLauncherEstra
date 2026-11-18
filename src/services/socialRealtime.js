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

export function subscribeSocialRealtime({ accessToken, userId, socialServerUrl, onChange, onDirectMessage }) {
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_user_servers', filter: `user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_game_invites', filter: `to_user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'launcher_game_invites', filter: `from_user_id=eq.${userId}` }, triggerRefresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'launcher_direct_messages', filter: `recipient_id=eq.${userId}` }, payload => {
      onDirectMessage?.(payload);
      triggerRefresh();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'launcher_direct_messages', filter: `sender_id=eq.${userId}` }, payload => {
      onDirectMessage?.(payload);
    })
    .subscribe();

  return () => {
    clearTimeout(timer);
    void client.removeChannel(channel);
  };
}

export function subscribeChatTyping({ accessToken, userId, friendId, socialServerUrl, onFriendTyping }) {
  if (!accessToken || !userId || !friendId || !isSupabaseGatewayUrl(socialServerUrl)) {
    return { sendTyping: () => {}, unsubscribe: () => {} };
  }

  const client = getMemorySupabaseClient();
  client.realtime.setAuth(accessToken);

  const pairKey = String(userId) <= String(friendId) ? `${userId}:${friendId}` : `${friendId}:${userId}`;
  const channel = client
    .channel(`estra-dm-typing-${pairKey}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.senderId === friendId) {
        onFriendTyping?.();
      }
    })
    .subscribe();

  let lastSentAt = 0;
  const sendTyping = () => {
    const now = Date.now();
    if (now - lastSentAt < 1500) return;
    lastSentAt = now;
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { senderId: userId }
    }).catch(() => {});
  };

  return {
    sendTyping,
    unsubscribe: () => {
      void client.removeChannel(channel);
    }
  };
}
