import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSocialStore } from '../src/server/socialStore.js';
import { createApi } from '../src/server/api.js';
import {
  LOCAL_SOCIAL_SENTINEL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SOCIAL_GATEWAY_URL,
  resolveSocialServerUrl
} from '../src/shared/supabaseConfig.js';
import { DEFAULT_SETTINGS } from '../src/services/storageService.js';
import { validateAvatarUrl } from '../src/shared/profileAvatar.js';
import { resolveCommunityLinks, sanitizeExternalUrl } from '../src/shared/communityLinks.js';

test('socialStore handles register, password hashing, login, friend requests, presence, and favorites', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-social-'));
  const dbPath = path.join(dir, 'social.db');
  const store = createSocialStore({ dbPath });
  t.after(async () => {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const alice = store.register({ username: 'alice_rp', password: 'secret123', displayName: 'Alice' });
  assert.equal(alice.user.username, 'alice_rp');
  assert.match(alice.user.friendCode, /^ESTRA-[A-Z0-9]{4}$/);
  assert.equal(alice.user.presence, 'online');

  assert.throws(() => store.register({ username: 'alice_rp', password: 'secret123' }), /ถูกใช้งานแล้ว/);
  assert.throws(() => store.login({ username: 'alice_rp', password: 'wrongpass' }), /ไม่ถูกต้อง/);

  const bob = store.register({ username: 'bob_rp', password: 'password99', displayName: 'Bob' });
  const charlie = store.register({ username: 'charlie_rp', password: 'password99', displayName: 'Charlie' });

  // Send friend request by friend code and by username
  const req1 = store.sendFriendRequest(alice.user.id, bob.user.friendCode);
  assert.equal(req1.status, 'pending');
  const req2 = store.sendFriendRequest(alice.user.id, 'charlie_rp');
  assert.equal(req2.status, 'pending');

  // Bob sees incoming request; Charlie cannot accept Bob's request
  const bobState = store.getSocialState(bob.user.id);
  assert.equal(bobState.incomingRequests.length, 1);
  assert.throws(() => store.respondFriendRequest(charlie.user.id, bobState.incomingRequests[0].id, 'accept'), /ไม่มีสิทธิ์/);

  store.respondFriendRequest(bob.user.id, bobState.incomingRequests[0].id, 'accept');
  const charlieState = store.getSocialState(charlie.user.id);
  store.respondFriendRequest(charlie.user.id, charlieState.incomingRequests[0].id, 'accept');

  // Alice stars Charlie as favorite and sets Bob away, Alice playing Noxtis Legacy
  store.toggleFavoriteFriend(alice.user.id, charlie.user.id, true);
  store.updateHeartbeat(bob.user.id, { statusPref: 'away' });
  store.updateHeartbeat(charlie.user.id, {
    statusPref: 'online',
    activeServer: { id: 'noxtis-legacy', name: 'Noxtis Legacy', ip: '89.38.101.136:30120' }
  });

  const aliceState = store.getSocialState(alice.user.id);
  assert.equal(aliceState.friends.length, 2);
  // Favorite friend Charlie comes first
  assert.equal(aliceState.friends[0].username, 'charlie_rp');
  assert.equal(aliceState.friends[0].isFavorite, true);
  assert.equal(aliceState.friends[0].presence, 'in-game');
  assert.equal(aliceState.friends[0].currentServer.name, 'Noxtis Legacy');
  assert.equal(aliceState.friends[1].username, 'bob_rp');
  assert.equal(aliceState.friends[1].presence, 'away');

  // Invisible hides online status from friends
  store.updateHeartbeat(charlie.user.id, { statusPref: 'invisible' });
  const afterInvisible = store.getSocialState(alice.user.id);
  assert.equal(afterInvisible.friends[0].presence, 'offline');

  // Favorite server persistence per user
  const favRes = store.toggleFavoriteServer(alice.user.id, {
    id: 'noxtis-legacy',
    name: 'Noxtis Legacy',
    ip: '89.38.101.136:30120',
    tag: 'Roleplay'
  }, true);
  assert.equal(favRes.favoriteServers.length, 1);
  assert.equal(store.resolveSession(alice.token).favoriteServers.length, 1);

  // Logout invalidates session
  store.logout(alice.token);
  assert.equal(store.resolveSession(alice.token), null);
});

test('HTTP social API uses HttpOnly cookies and enforces auth', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-social-http-'));
  const socialStore = createSocialStore({ dbPath: path.join(dir, 'social.db') });
  const middleware = createApi({ socialStore });
  const server = http.createServer(middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    socialStore.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/session`)).json();

  // Unauthenticated state rejected
  assert.equal((await fetch(`${base}/api/social/state`)).status, 401);

  const regRes = await fetch(`${base}/api/social/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
    body: JSON.stringify({ username: 'sora_test', password: 'password123', displayName: 'Sora' })
  });
  assert.equal(regRes.status, 200);
  const setCookie = regRes.headers.get('set-cookie') || '';
  assert.match(setCookie, /estra_social_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const cookiePair = setCookie.split(';')[0];

  const meRes = await fetch(`${base}/api/social/me`, { headers: { Cookie: cookiePair } });
  const meJson = await meRes.json();
  assert.equal(meJson.authenticated, true);
  assert.equal(meJson.user.username, 'sora_test');

  const demoRes = await fetch(`${base}/api/social/demo-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, Cookie: cookiePair },
    body: '{}'
  });
  assert.equal(demoRes.status, 200);
  const demoJson = await demoRes.json();
  assert.ok(demoJson.friends.length >= 4);
  assert.ok(demoJson.friends.some(f => f.isFavorite));
});

test('DEFAULT_SETTINGS defaults to Supabase Cloud and resolves local sentinel cleanly', () => {
  assert.equal(DEFAULT_SETTINGS.socialServerUrl, SUPABASE_SOCIAL_GATEWAY_URL);
  assert.equal(resolveSocialServerUrl(''), SUPABASE_SOCIAL_GATEWAY_URL);
  assert.equal(resolveSocialServerUrl(LOCAL_SOCIAL_SENTINEL), '');
  assert.equal(resolveSocialServerUrl('https://custom.example.com'), 'https://custom.example.com');
});

test('HTTP social API enforces BFF rate limiting with 429 and Retry-After', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-social-rl-'));
  const socialStore = createSocialStore({ dbPath: path.join(dir, 'social.db') });
  const middleware = createApi({
    socialStore,
    socialRateLimits: {
      '/api/social/login': { max: 2, windowMs: 60_000 }
    }
  });
  const server = http.createServer(middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    socialStore.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/session`)).json();

  for (let i = 0; i < 2; i += 1) {
    const res = await fetch(`${base}/api/social/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
      body: JSON.stringify({ username: 'missing_user', password: 'password123' })
    });
    assert.equal(res.status, 401);
  }

  const limited = await fetch(`${base}/api/social/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token },
    body: JSON.stringify({ username: 'missing_user', password: 'password123' })
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  const limitedJson = await limited.json();
  assert.equal(limitedJson.success, false);
  assert.match(limitedJson.error, /บ่อยเกินไป/);
});

test('Supabase social proxy stores tokens in HttpOnly cookies, strips response tokens, and serves realtime-token', async t => {
  const realFetch = globalThis.fetch;
  const capturedUpstream = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(SUPABASE_SOCIAL_GATEWAY_URL)) {
      capturedUpstream.push({ url: u, headers: init.headers || {} });
      if (u.endsWith('/api/social/login')) {
        return new Response(
          JSON.stringify({
            success: true,
            authenticated: true,
            mode: 'supabase',
            user: { id: 'u1', username: 'cloud_user', displayName: 'Cloud' },
            favoriteServers: [],
            token: 'jwt-access-secret',
            refreshToken: 'refresh-secret'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.endsWith('/api/social/friend-request')) {
        return new Response(
          JSON.stringify({ success: false, error: 'Too many requests', retryAfter: 42 }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '42' } }
        );
      }
      return new Response(JSON.stringify({ success: true, mode: 'supabase' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(url, init);
  };

  const middleware = createApi();
  const server = http.createServer(middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    globalThis.fetch = realFetch;
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await realFetch(`${base}/api/session`).then(r => r.json());

  const loginRes = await realFetch(`${base}/api/social/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Launcher-Token': token,
      'X-Social-Server': SUPABASE_SOCIAL_GATEWAY_URL
    },
    body: JSON.stringify({ username: 'cloud_user', password: 'password123' })
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.token, undefined);
  assert.equal(loginBody.refreshToken, undefined);
  assert.equal(loginBody.user.username, 'cloud_user');
  assert.equal(capturedUpstream[0].headers.apikey, SUPABASE_PUBLISHABLE_KEY);

  const setCookies = loginRes.headers.getSetCookie();
  assert.equal(setCookies.length, 2);
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
  assert.match(cookieHeader, /estra_social_session=jwt-access-secret/);
  assert.match(cookieHeader, /estra_social_refresh=refresh-secret/);

  const rtRes = await realFetch(`${base}/api/social/realtime-token`, {
    headers: { 'X-Social-Server': SUPABASE_SOCIAL_GATEWAY_URL, Cookie: cookieHeader }
  });
  assert.equal(rtRes.status, 200);
  const rtJson = await rtRes.json();
  assert.equal(rtJson.accessToken, 'jwt-access-secret');

  const rlRes = await realFetch(`${base}/api/social/friend-request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Launcher-Token': token,
      'X-Social-Server': SUPABASE_SOCIAL_GATEWAY_URL,
      Cookie: cookieHeader
    },
    body: JSON.stringify({ target: 'bob' })
  });
  assert.equal(rlRes.status, 429);
  assert.equal(rlRes.headers.get('retry-after'), '42');
});

test('validateAvatarUrl, socialStore.updateProfile, and /api/social/profile-update enforce safe avatar handling', async t => {
  assert.equal(validateAvatarUrl('').valid, true);
  assert.equal(validateAvatarUrl('https://cdn.example.com/avatar.png').valid, true);
  assert.equal(validateAvatarUrl('data:image/png;base64,iVBORw0KGgo=').valid, true);
  assert.equal(validateAvatarUrl('data:image/svg+xml;base64,PHN2Zz4=').valid, false);
  assert.equal(validateAvatarUrl('javascript:alert(1)').valid, false);
  assert.equal(validateAvatarUrl('http://insecure.example.com/a.png').valid, false);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estra-avatar-'));
  const dbPath = path.join(dir, 'social.db');
  const store = createSocialStore({ dbPath });
  const middleware = createApi({ socialStore: store });
  const server = http.createServer(middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await fetch(`${base}/api/session`).then(r => r.json());
  const regRes = await fetch(`${base}/api/social/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, 'X-Social-Server': LOCAL_SOCIAL_SENTINEL },
    body: JSON.stringify({ username: 'avatar_tester', password: 'password123', displayName: 'BeforeName' })
  });
  assert.equal(regRes.status, 200);
  const cookieHeader = regRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  const badRes = await fetch(`${base}/api/social/profile-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, 'X-Social-Server': LOCAL_SOCIAL_SENTINEL, Cookie: cookieHeader },
    body: JSON.stringify({ avatarUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })
  });
  assert.equal(badRes.status, 400);

  const validDataUrl = 'data:image/png;base64,' + 'A'.repeat(20000);
  const okRes = await fetch(`${base}/api/social/profile-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': token, 'X-Social-Server': LOCAL_SOCIAL_SENTINEL, Cookie: cookieHeader },
    body: JSON.stringify({ displayName: 'AfterName', avatarColor: '#10b981', avatarUrl: validDataUrl })
  });
  assert.equal(okRes.status, 200);
  const okJson = await okRes.json();
  assert.equal(okJson.user.displayName, 'AfterName');
  assert.equal(okJson.user.avatarColor, '#10b981');
  assert.equal(okJson.user.avatarUrl, validDataUrl);

  const meRes = await fetch(`${base}/api/social/me`, {
    headers: { 'X-Social-Server': LOCAL_SOCIAL_SENTINEL, Cookie: cookieHeader }
  }).then(r => r.json());
  assert.equal(meRes.user.avatarUrl, validDataUrl);
});

test('sanitizeExternalUrl validates official community links safely', () => {
  assert.equal(sanitizeExternalUrl('https://estra.example.com/home'), 'https://estra.example.com/home');
  assert.equal(sanitizeExternalUrl('discord.gg/estra'), 'https://discord.gg/estra');
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('//evil.example.com'), '');
  assert.equal(sanitizeExternalUrl('not a url'), '');
  assert.equal(sanitizeExternalUrl('https://user:pass@example.com'), '');

  const defaults = resolveCommunityLinks();
  assert.equal(defaults.websiteUrl, 'https://estralauncher.vercel.app/');
  assert.equal(defaults.discordUrl, 'https://discord.gg/WYjfK6FWgB');
  assert.equal(defaults.facebookUrl, 'https://www.facebook.com/estralauncher');
});
