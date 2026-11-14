import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getSystemPresence } from './systemPresence.js';
import {
  queryLiveServer,
  executeRealLaunch,
  executeRealCleanCache,
  resolveInstallation,
  detectGameEnvironment,
  installFiveMBootstrap
} from './fivemBackend.js';
import { previewMaintenance, cleanMaintenance } from './maintenance.js';
import { createSocialStore } from './socialStore.js';
import { SUPABASE_PUBLISHABLE_KEY, isSupabaseGatewayUrl } from '../shared/supabaseConfig.js';

const SOCIAL_COOKIE = 'estra_social_session';
const SOCIAL_REFRESH_COOKIE = 'estra_social_refresh';

const DEFAULT_SOCIAL_RATE_LIMITS = {
  '/api/social/register': { max: 6, windowMs: 10 * 60_000 },
  '/api/social/login': { max: 15, windowMs: 5 * 60_000 },
  '/api/social/friend-request': { max: 20, windowMs: 60 * 60_000 },
  '/api/social/game-invite': { max: 20, windowMs: 10 * 60_000 },
  '/api/social/search': { max: 40, windowMs: 60_000 },
  '/api/social/heartbeat': { max: 40, windowMs: 60_000 },
  defaultMutation: { max: 60, windowMs: 60_000 },
  defaultRead: { max: 120, windowMs: 60_000 }
};

const send = (res, status, data, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
};

function parseCookies(header) {
  const result = {};
  if (typeof header !== 'string') return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

function cookieHeader(name, token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  return `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

function sessionCookieHeader(token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  return cookieHeader(SOCIAL_COOKIE, token, maxAgeSeconds);
}

function createSocialRateLimiter(overrides = {}) {
  const buckets = new Map();
  const rules = { ...DEFAULT_SOCIAL_RATE_LIMITS, ...overrides };

  return (pathname, isPost, clientKey) => {
    const rule = rules[pathname] || (isPost ? rules.defaultMutation : rules.defaultRead);
    if (!rule || rule.max <= 0) return null;
    const now = Date.now();
    if (buckets.size > 500) {
      for (const [k, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(k);
      }
    }
    const key = `${pathname}:${clientKey}`;
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + rule.windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > rule.max) {
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    }
    return null;
  };
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw Object.assign(new Error('ข้อมูลใหญ่เกินกำหนด'), { status: 413 });
  }
  try {
    const data = JSON.parse(body || '{}');
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error('JSON ไม่ถูกต้อง'), { status: 400 });
  }
}

function normalizeRemoteSocialUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.toLowerCase() === 'local') return '';
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function createApi(services = {}) {
  const token = randomBytes(32).toString('hex');
  const handlers = {
    getSystemPresence,
    queryLiveServer,
    executeRealLaunch,
    executeRealCleanCache,
    resolveInstallation,
    detectGameEnvironment,
    installFiveMBootstrap,
    previewMaintenance,
    cleanMaintenance,
    ...services
  };
  let socialStore = services.socialStore || null;
  const getSocial = () => {
    if (!socialStore) socialStore = createSocialStore();
    return socialStore;
  };
  const checkSocialRateLimit = createSocialRateLimiter(services.socialRateLimits);
  let mutationBusy = false;

  return async (req, res, next = () => send(res, 404, { error: 'Not found' })) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    const pathname = urlObj.pathname;
    if (!pathname.startsWith('/api/')) return next();

    const host = req.headers.host || '';
    const localPort = req.socket.localPort;
    const validHost = host === `127.0.0.1:${localPort}` || host === `localhost:${localPort}`;
    const remote = req.socket.remoteAddress;
    const origin = req.headers.origin;
    if (
      !validHost ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
      (origin && origin !== `http://${host}`) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      return send(res, 403, { error: 'อนุญาตเฉพาะหน้า Launcher ในเครื่องนี้' });
    }

    const routes = {
      '/api/session': 'GET',
      '/api/system-presence': 'GET',
      '/api/server-query': 'GET',
      '/api/installation': 'GET',
      '/api/game-environment': 'GET',
      '/api/install-fivem': 'POST',
      '/api/launch-fivem': 'POST',
      '/api/clean-cache': 'POST',
      '/api/maintenance-preview': 'GET',
      '/api/clean-maintenance': 'POST',
      '/api/social/me': 'GET',
      '/api/social/state': 'GET',
      '/api/social/search': 'GET',
      '/api/social/realtime-token': 'GET',
      '/api/social/register': 'POST',
      '/api/social/login': 'POST',
      '/api/social/logout': 'POST',
      '/api/social/heartbeat': 'POST',
      '/api/social/friend-request': 'POST',
      '/api/social/friend-respond': 'POST',
      '/api/social/friend-favorite': 'POST',
      '/api/social/friend-remove': 'POST',
      '/api/social/server-favorite': 'POST',
      '/api/social/demo-seed': 'POST',
      '/api/social/game-invite': 'POST',
      '/api/social/game-invite-respond': 'POST'
    };

    if (!routes[pathname]) return send(res, 404, { error: 'API not found' });
    if (req.method !== routes[pathname]) {
      res.setHeader('Allow', routes[pathname]);
      return send(res, 405, { error: 'Method not allowed' });
    }

    const isPost = req.method === 'POST';
    const isSocial = pathname.startsWith('/api/social/');
    const isHardwareMutation = ['/api/launch-fivem', '/api/clean-cache', '/api/clean-maintenance', '/api/install-fivem'].includes(pathname);

    if (isPost) {
      const supplied = Buffer.from(String(req.headers['x-launcher-token'] || ''));
      if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) {
        return send(res, 403, { error: 'Session หมดอายุ กรุณาโหลดหน้าใหม่' });
      }
      if (!req.headers['content-type']?.startsWith('application/json')) {
        return send(res, 415, { error: 'ต้องส่ง application/json' });
      }
      if (isHardwareMutation) {
        if (mutationBusy) return send(res, 409, { error: 'มีคำสั่งกำลังทำงาน กรุณารอสักครู่' });
        mutationBusy = true;
      }
    }

    try {
      const params = urlObj.searchParams;

      if (isSocial) {
        const retryAfter = checkSocialRateLimit(pathname, isPost, remote || 'local');
        if (retryAfter) {
          return send(
            res,
            429,
            {
              success: false,
              error: `คุณส่งคำขอบ่อยเกินไป กรุณารอ ${retryAfter} วินาที แล้วลองใหม่อีกครั้ง`,
              retryAfter
            },
            { 'Retry-After': String(retryAfter) }
          );
        }

        const cookies = parseCookies(req.headers.cookie);
        const remoteSocialBase = normalizeRemoteSocialUrl(req.headers['x-social-server']);
        if (remoteSocialBase) {
          const isSupabase = isSupabaseGatewayUrl(remoteSocialBase);
          if (pathname === '/api/social/realtime-token') {
            if (!cookies[SOCIAL_COOKIE] && !cookies[SOCIAL_REFRESH_COOKIE]) {
              return send(res, 401, { success: false, error: 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' });
            }
            if (!isSupabase) {
              return send(res, 200, { success: true, mode: 'remote', accessToken: null });
            }
            if (cookies[SOCIAL_COOKIE]) {
              return send(res, 200, { success: true, mode: 'supabase', accessToken: cookies[SOCIAL_COOKIE] });
            }
          }

          const upstreamPath = pathname === '/api/social/realtime-token' ? '/api/social/me' : `${pathname}${urlObj.search}`;
          const targetUrl = `${remoteSocialBase}${upstreamPath}`;
          const headers = { 'Content-Type': 'application/json' };
          if (isSupabase) {
            headers.apikey = SUPABASE_PUBLISHABLE_KEY;
            if (cookies[SOCIAL_COOKIE]) headers.Authorization = `Bearer ${cookies[SOCIAL_COOKIE]}`;
            if (cookies[SOCIAL_REFRESH_COOKIE]) headers['X-Refresh-Token'] = cookies[SOCIAL_REFRESH_COOKIE];
          } else if (req.headers.cookie) {
            headers.Cookie = req.headers.cookie;
          }
          const body = isPost ? JSON.stringify(await readBody(req)) : undefined;
          const upstream = await fetch(targetUrl, {
            method: req.method,
            headers,
            body,
            signal: AbortSignal.timeout(12000)
          });
          const text = await upstream.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}

          const setCookies = [];
          const upstreamCookie = upstream.headers.get('set-cookie');
          if (upstreamCookie) setCookies.push(upstreamCookie);

          if (isSupabase && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if (typeof parsed.token === 'string' && parsed.token) {
              setCookies.push(cookieHeader(SOCIAL_COOKIE, parsed.token));
              if (pathname === '/api/social/realtime-token') {
                const accessToken = parsed.token;
                return send(
                  res,
                  200,
                  { success: true, mode: 'supabase', accessToken },
                  setCookies.length
                    ? {
                        'Set-Cookie': typeof parsed.refreshToken === 'string' && parsed.refreshToken
                          ? [cookieHeader(SOCIAL_COOKIE, accessToken), cookieHeader(SOCIAL_REFRESH_COOKIE, parsed.refreshToken)]
                          : cookieHeader(SOCIAL_COOKIE, accessToken)
                      }
                    : {}
                );
              }
              delete parsed.token;
            } else if (pathname === '/api/social/realtime-token') {
              return send(res, 401, { success: false, error: 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' });
            }
            if (typeof parsed.refreshToken === 'string' && parsed.refreshToken) {
              setCookies.push(cookieHeader(SOCIAL_REFRESH_COOKIE, parsed.refreshToken));
              delete parsed.refreshToken;
            }
            if (pathname === '/api/social/logout') {
              setCookies.push(cookieHeader(SOCIAL_COOKIE, '', 0));
              setCookies.push(cookieHeader(SOCIAL_REFRESH_COOKIE, '', 0));
            }
          }

          const resHeaders = {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          };
          const upstreamRetryAfter = upstream.headers.get('retry-after');
          if (upstreamRetryAfter) resHeaders['Retry-After'] = upstreamRetryAfter;
          if (setCookies.length === 1) resHeaders['Set-Cookie'] = setCookies[0];
          else if (setCookies.length > 1) resHeaders['Set-Cookie'] = setCookies;
          res.writeHead(upstream.status, resHeaders);
          res.end(parsed ? JSON.stringify(parsed) : text);
          return;
        }

        const social = getSocial();
        const sessionToken = cookies[SOCIAL_COOKIE] || '';
        const session = social.resolveSession(sessionToken);

        if (pathname === '/api/social/realtime-token') {
          if (!session) return send(res, 401, { success: false, error: 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' });
          return send(res, 200, { success: true, mode: 'local-sqlite', accessToken: null });
        }

        if (pathname === '/api/social/me') {
          return send(res, 200, {
            success: true,
            authenticated: !!session,
            mode: 'local-sqlite',
            user: session?.user || null,
            favoriteServers: session?.favoriteServers || []
          });
        }

        if (pathname === '/api/social/register') {
          const body = await readBody(req);
          const created = social.register(body);
          return send(
            res,
            200,
            {
              success: true,
              authenticated: true,
              mode: 'local-sqlite',
              user: created.user,
              favoriteServers: created.favoriteServers
            },
            { 'Set-Cookie': sessionCookieHeader(created.token) }
          );
        }

        if (pathname === '/api/social/login') {
          const body = await readBody(req);
          const loggedIn = social.login(body);
          return send(
            res,
            200,
            {
              success: true,
              authenticated: true,
              mode: 'local-sqlite',
              user: loggedIn.user,
              favoriteServers: loggedIn.favoriteServers
            },
            { 'Set-Cookie': sessionCookieHeader(loggedIn.token) }
          );
        }

        if (pathname === '/api/social/logout') {
          await readBody(req).catch(() => ({}));
          social.logout(sessionToken);
          return send(
            res,
            200,
            { success: true, authenticated: false, user: null },
            { 'Set-Cookie': sessionCookieHeader('', 0) }
          );
        }

        if (!session) {
          return send(res, 401, { success: false, error: 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' });
        }

        const userId = session.user.id;
        if (pathname === '/api/social/state') {
          return send(res, 200, { success: true, mode: 'local-sqlite', ...social.getSocialState(userId) });
        }
        if (pathname === '/api/social/search') {
          return send(res, 200, { success: true, users: social.searchUsers(userId, params.get('q') || '') });
        }

        const body = await readBody(req);
        if (pathname === '/api/social/heartbeat') {
          return send(res, 200, { success: true, ...social.updateHeartbeat(userId, body) });
        }
        if (pathname === '/api/social/friend-request') {
          const result = social.sendFriendRequest(userId, body.target);
          return send(res, 200, { success: true, ...result, ...social.getSocialState(userId) });
        }
        if (pathname === '/api/social/friend-respond') {
          const result = social.respondFriendRequest(userId, body.requestId, body.action);
          return send(res, 200, { success: true, ...result, ...social.getSocialState(userId) });
        }
        if (pathname === '/api/social/friend-favorite') {
          const result = social.toggleFavoriteFriend(userId, body.friendId, body.favorite);
          return send(res, 200, { success: true, ...result, ...social.getSocialState(userId) });
        }
        if (pathname === '/api/social/friend-remove') {
          const result = social.removeFriend(userId, body.friendId);
          return send(res, 200, { success: true, ...result, ...social.getSocialState(userId) });
        }
        if (pathname === '/api/social/server-favorite') {
          const result = social.toggleFavoriteServer(userId, body.server, body.favorite);
          return send(res, 200, { success: true, ...result });
        }
        if (pathname === '/api/social/demo-seed') {
          return send(res, 200, { success: true, ...social.seedDemoFriendsForUser(userId) });
        }
        if (pathname === '/api/social/game-invite') {
          return send(res, 200, { success: true, ...social.sendGameInvite(userId, body.friendId, body.server) });
        }
        if (pathname === '/api/social/game-invite-respond') {
          return send(res, 200, { success: true, ...social.respondGameInvite(userId, body.inviteId, body.action) });
        }
      }

      let result;
      if (pathname === '/api/session') result = { token, platform: process.platform };
      if (pathname === '/api/system-presence') result = await handlers.getSystemPresence();
      if (pathname === '/api/server-query') result = await handlers.queryLiveServer(params.get('target'));
      if (pathname === '/api/installation') result = { success: true, ...await handlers.resolveInstallation(params.get('path') || '') };
      if (pathname === '/api/game-environment') result = await handlers.detectGameEnvironment(params.get('path') || '');
      if (pathname === '/api/maintenance-preview') result = await handlers.previewMaintenance({ fivemPath: params.get('path') || '' });
      if (isHardwareMutation) {
        const body = await readBody(req);
        result = pathname === '/api/launch-fivem'
          ? await handlers.executeRealLaunch(body)
          : pathname === '/api/clean-maintenance'
            ? await handlers.cleanMaintenance(body)
            : pathname === '/api/install-fivem'
              ? await handlers.installFiveMBootstrap(body)
              : await handlers.executeRealCleanCache(body);
      }
      send(res, result.success === false ? 409 : 200, result);
    } catch (error) {
      send(res, error.status || 400, { success: false, error: error.message });
    } finally {
      if (isHardwareMutation) mutationBusy = false;
    }
  };
}
