import { apiGet, apiPost } from './apiService.js';
import { resolveSocialServerUrl } from '../shared/supabaseConfig.js';

function socialHeaders(socialServerUrl) {
  const clean = resolveSocialServerUrl(socialServerUrl);
  return clean ? { 'X-Social-Server': clean } : {};
}

export async function fetchSocialSession(socialServerUrl) {
  return apiGet('/api/social/me', undefined, socialHeaders(socialServerUrl));
}

export async function fetchRealtimeToken(socialServerUrl) {
  return apiGet('/api/social/realtime-token', undefined, socialHeaders(socialServerUrl));
}

export async function fetchSocialState(socialServerUrl) {
  return apiGet('/api/social/state', undefined, socialHeaders(socialServerUrl));
}

export async function registerAccount(payload, socialServerUrl) {
  return apiPost('/api/social/register', payload, socialHeaders(socialServerUrl));
}

export async function loginAccount(payload, socialServerUrl) {
  return apiPost('/api/social/login', payload, socialHeaders(socialServerUrl));
}

export async function logoutAccount(socialServerUrl) {
  return apiPost('/api/social/logout', {}, socialHeaders(socialServerUrl));
}

export async function sendHeartbeat(payload, socialServerUrl) {
  return apiPost('/api/social/heartbeat', payload, socialHeaders(socialServerUrl));
}

export async function updateSocialProfile(payload, socialServerUrl) {
  return apiPost('/api/social/profile-update', payload, socialHeaders(socialServerUrl));
}

export async function changePassword(payload, socialServerUrl) {
  return apiPost('/api/social/change-password', payload, socialHeaders(socialServerUrl));
}

export async function sendFriendRequest(target, socialServerUrl) {
  return apiPost('/api/social/friend-request', { target }, socialHeaders(socialServerUrl));
}

export async function respondFriendRequest(requestId, action, socialServerUrl) {
  return apiPost('/api/social/friend-respond', { requestId, action }, socialHeaders(socialServerUrl));
}

export async function toggleFavoriteFriend(friendId, favorite, socialServerUrl) {
  return apiPost('/api/social/friend-favorite', { friendId, favorite }, socialHeaders(socialServerUrl));
}

export async function removeFriend(friendId, socialServerUrl) {
  return apiPost('/api/social/friend-remove', { friendId }, socialHeaders(socialServerUrl));
}

export async function toggleRemoteFavoriteServer(server, favorite, socialServerUrl) {
  return apiPost('/api/social/server-favorite', { server, favorite }, socialHeaders(socialServerUrl));
}

export async function searchSocialUsers(query, socialServerUrl) {
  return apiGet(`/api/social/search?q=${encodeURIComponent(query || '')}`, undefined, socialHeaders(socialServerUrl));
}

export async function seedDemoFriends(socialServerUrl) {
  return apiPost('/api/social/demo-seed', {}, socialHeaders(socialServerUrl));
}

export async function sendGameInvite(friendId, server, socialServerUrl) {
  return apiPost('/api/social/game-invite', { friendId, server }, socialHeaders(socialServerUrl));
}

export async function respondGameInvite(inviteId, action, socialServerUrl) {
  return apiPost('/api/social/game-invite-respond', { inviteId, action }, socialHeaders(socialServerUrl));
}
