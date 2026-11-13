import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getSystemPresence } from './systemPresence.js';
import { queryLiveServer, executeRealLaunch, executeRealCleanCache, resolveInstallation } from './fivemBackend.js';
import { previewMaintenance, cleanMaintenance } from './maintenance.js';

const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw Object.assign(new Error('ข้อมูลใหญ่เกินกำหนด'), { status: 413 });
  }
  try { const data = JSON.parse(body || '{}'); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); return data; }
  catch { throw Object.assign(new Error('JSON ไม่ถูกต้อง'), { status: 400 }); }
}
export function createApi(services = {}) {
  const token = randomBytes(32).toString('hex');
  const handlers = { getSystemPresence, queryLiveServer, executeRealLaunch, executeRealCleanCache, resolveInstallation, previewMaintenance, cleanMaintenance, ...services };
  let mutationBusy = false;
  return async (req, res, next = () => send(res, 404, { error: 'Not found' })) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/')) return next();
    const host = req.headers.host || '';
    const localPort = req.socket.localPort;
    const validHost = host === `127.0.0.1:${localPort}` || host === `localhost:${localPort}`;
    const remote = req.socket.remoteAddress;
    const origin = req.headers.origin;
    if (!validHost || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) || (origin && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'อนุญาตเฉพาะหน้า Launcher ในเครื่องนี้' });
    const routes = { '/api/session': 'GET', '/api/system-presence': 'GET', '/api/server-query': 'GET', '/api/installation': 'GET', '/api/launch-fivem': 'POST', '/api/clean-cache': 'POST', '/api/maintenance-preview': 'GET', '/api/clean-maintenance': 'POST' };
    if (!routes[pathname]) return send(res, 404, { error: 'API not found' });
    if (req.method !== routes[pathname]) { res.setHeader('Allow', routes[pathname]); return send(res, 405, { error: 'Method not allowed' }); }
    const mutation = req.method === 'POST';
    if (mutation) {
      const supplied = Buffer.from(String(req.headers['x-launcher-token'] || ''));
      if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return send(res, 403, { error: 'Session หมดอายุ กรุณาโหลดหน้าใหม่' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'ต้องส่ง application/json' });
      if (mutationBusy) return send(res, 409, { error: 'มีคำสั่งกำลังทำงาน กรุณารอสักครู่' });
      mutationBusy = true;
    }
    try {
      const params = new URL(req.url, 'http://127.0.0.1').searchParams;
      let result;
      if (pathname === '/api/session') result = { token, platform: process.platform };
      if (pathname === '/api/system-presence') result = await handlers.getSystemPresence();
      if (pathname === '/api/server-query') result = await handlers.queryLiveServer(params.get('target'));
      if (pathname === '/api/installation') result = { success: true, ...await handlers.resolveInstallation(params.get('path') || '') };
      if (pathname === '/api/maintenance-preview') result = await handlers.previewMaintenance({ fivemPath: params.get('path') || '' });
      if (mutation) {
        const body = await readBody(req);
        result = pathname === '/api/launch-fivem' ? await handlers.executeRealLaunch(body) : pathname === '/api/clean-maintenance' ? await handlers.cleanMaintenance(body) : await handlers.executeRealCleanCache(body);
      }
      send(res, result.success === false ? 409 : 200, result);
    } catch (error) { send(res, error.status || 400, { success: false, error: error.message }); }
    finally { if (mutation) mutationBusy = false; }
  };
}

