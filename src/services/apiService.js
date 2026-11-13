import { invoke } from '@tauri-apps/api/core';
import { isTauriDesktop } from './desktopBridge.js';

let sessionPromise;

async function readResponse(response) {
  let data;
  try { data = await response.json(); } catch { throw new Error('ไม่พบ API ของ Launcher กรุณาเปิดผ่าน npm start'); }
  if (!response.ok || data.success === false) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { details: data });
  return data;
}

async function invokeTauri(cmd, args) {
  try {
    return await invoke(cmd, args);
  } catch (err) {
    const message = typeof err === 'string' ? err : err?.message || 'เกิดข้อผิดพลาดในระบบเดสก์ท็อป';
    throw new Error(message);
  }
}

async function tauriGet(url) {
  const parsed = new URL(url, 'http://127.0.0.1');
  if (parsed.pathname === '/api/session') return { token: 'tauri-ipc', platform: 'win32' };
  if (parsed.pathname === '/api/system-presence') return invokeTauri('get_system_presence_cmd');
  if (parsed.pathname === '/api/server-query') return invokeTauri('query_server_cmd', { target: parsed.searchParams.get('target') || '' });
  if (parsed.pathname === '/api/installation') {
    const res = await invokeTauri('resolve_installation_cmd', { path: parsed.searchParams.get('path') || '' });
    return { success: true, ...res };
  }
  if (parsed.pathname === '/api/maintenance-preview') {
    return invokeTauri('preview_maintenance_cmd', { fivemPath: parsed.searchParams.get('path') || '' });
  }
  throw new Error(`Unsupported Tauri GET route: ${parsed.pathname}`);
}

async function tauriPost(url, body = {}) {
  const parsed = new URL(url, 'http://127.0.0.1');
  if (parsed.pathname === '/api/launch-fivem') return invokeTauri('launch_fivem_cmd', { request: body });
  if (parsed.pathname === '/api/clean-cache') return invokeTauri('clean_cache_cmd', { fivemPath: body.fivemPath || '' });
  if (parsed.pathname === '/api/clean-maintenance') return invokeTauri('clean_maintenance_cmd', { request: body });
  throw new Error(`Unsupported Tauri POST route: ${parsed.pathname}`);
}

export async function apiGet(url, signal) {
  if (isTauriDesktop()) return tauriGet(url);
  return readResponse(await fetch(url, { signal: signal || AbortSignal.timeout(11000) }));
}

export async function apiPost(url, body = {}) {
  if (isTauriDesktop()) return tauriPost(url, body);
  sessionPromise ||= apiGet('/api/session').catch(error => { sessionPromise = null; throw error; });
  const session = await sessionPromise;
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Launcher-Token': session.token },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000)
  });
  if (response.status === 403) sessionPromise = null;
  return readResponse(response);
}
