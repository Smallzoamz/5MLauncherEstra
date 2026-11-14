import http from 'node:http';
import { createSocialStore } from './socialStore.js';

const SOCIAL_COOKIE = 'estra_social_session';

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

function getBearerOrCookieToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return parseCookies(req.headers.cookie)[SOCIAL_COOKIE] || '';
}

function send(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) throw Object.assign(new Error('ข้อมูลใหญ่เกินกำหนด'), { status: 413 });
  }
  try {
    const data = JSON.parse(body || '{}');
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error('JSON ไม่ถูกต้อง'), { status: 400 });
  }
}

export function createSocialHttpServer({ dbPath } = {}) {
  const store = createSocialStore({ dbPath });
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    const pathname = urlObj.pathname;
    try {
      if (pathname === '/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, service: 'estra-social-server' });
      }
      if (!pathname.startsWith('/api/social/')) {
        return send(res, 404, { success: false, error: 'Not found' });
      }

      const token = getBearerOrCookieToken(req);
      const session = store.resolveSession(token);
      const cookieFlags = process.env.NODE_ENV === 'production'
        ? 'HttpOnly; SameSite=Strict; Secure; Path=/'
        : 'HttpOnly; SameSite=Strict; Path=/';

      if (pathname === '/api/social/me' && req.method === 'GET') {
        return send(res, 200, {
          success: true,
          authenticated: !!session,
          mode: 'remote-social',
          user: session?.user || null,
          favoriteServers: session?.favoriteServers || []
        });
      }
      if (pathname === '/api/social/register' && req.method === 'POST') {
        const body = await readBody(req);
        const created = store.register(body);
        return send(
          res,
          200,
          { success: true, authenticated: true, mode: 'remote-social', user: created.user, favoriteServers: created.favoriteServers, token: created.token },
          { 'Set-Cookie': `${SOCIAL_COOKIE}=${encodeURIComponent(created.token)}; ${cookieFlags}; Max-Age=${30 * 24 * 60 * 60}` }
        );
      }
      if (pathname === '/api/social/login' && req.method === 'POST') {
        const body = await readBody(req);
        const loggedIn = store.login(body);
        return send(
          res,
          200,
          { success: true, authenticated: true, mode: 'remote-social', user: loggedIn.user, favoriteServers: loggedIn.favoriteServers, token: loggedIn.token },
          { 'Set-Cookie': `${SOCIAL_COOKIE}=${encodeURIComponent(loggedIn.token)}; ${cookieFlags}; Max-Age=${30 * 24 * 60 * 60}` }
        );
      }
      if (pathname === '/api/social/logout' && req.method === 'POST') {
        await readBody(req).catch(() => ({}));
        store.logout(token);
        return send(
          res,
          200,
          { success: true, authenticated: false, user: null },
          { 'Set-Cookie': `${SOCIAL_COOKIE}=; ${cookieFlags}; Max-Age=0` }
        );
      }

      if (!session) {
        return send(res, 401, { success: false, error: 'กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน' });
      }
      const userId = session.user.id;

      if (pathname === '/api/social/state' && req.method === 'GET') {
        return send(res, 200, { success: true, mode: 'remote-social', ...store.getSocialState(userId) });
      }
      if (pathname === '/api/social/search' && req.method === 'GET') {
        return send(res, 200, { success: true, users: store.searchUsers(userId, urlObj.searchParams.get('q') || '') });
      }

      if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Method not allowed' });
      const body = await readBody(req);

      if (pathname === '/api/social/heartbeat') {
        return send(res, 200, { success: true, ...store.updateHeartbeat(userId, body) });
      }
      if (pathname === '/api/social/profile-update') {
        return send(res, 200, { success: true, ...store.updateProfile(userId, body) });
      }
      if (pathname === '/api/social/friend-request') {
        return send(res, 200, { success: true, ...store.sendFriendRequest(userId, body.target), ...store.getSocialState(userId) });
      }
      if (pathname === '/api/social/friend-respond') {
        return send(res, 200, { success: true, ...store.respondFriendRequest(userId, body.requestId, body.action), ...store.getSocialState(userId) });
      }
      if (pathname === '/api/social/friend-favorite') {
        return send(res, 200, { success: true, ...store.toggleFavoriteFriend(userId, body.friendId, body.favorite), ...store.getSocialState(userId) });
      }
      if (pathname === '/api/social/friend-remove') {
        return send(res, 200, { success: true, ...store.removeFriend(userId, body.friendId), ...store.getSocialState(userId) });
      }
      if (pathname === '/api/social/server-favorite') {
        return send(res, 200, { success: true, ...store.toggleFavoriteServer(userId, body.server, body.favorite) });
      }

      return send(res, 404, { success: false, error: 'Social route not found' });
    } catch (error) {
      return send(res, error.status || 400, { success: false, error: error.message });
    }
  });
  return { server, store };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('socialServer.js')) {
  const port = Number(process.env.PORT || 5299);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createSocialHttpServer();
  server.listen(port, host, () => {
    console.log(`Estra Social Server listening on http://${host}:${port}`);
  });
}
