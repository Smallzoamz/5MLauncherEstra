import { apiGet, apiPost } from './apiService.js';
import { parseTarget } from '../shared/target.js';
export async function queryServerInfo(server, signal) {
  try {
    const target = parseTarget(server.ip).address;
    return await apiGet(`/api/server-query?target=${encodeURIComponent(target)}`, signal);
  } catch (error) {
    return { online: false, status: 'Unknown', clients: null, maxClients: null, gameBuild: null, lockPure: null, ping: null, error: error.message };
  }
}
export function launchFiveM(server, settings) {
  return apiPost('/api/launch-fivem', { ip: parseTarget(server.ip).address, cl2: !!server.cl2, fivemPath: settings.fivemPath, inGameName: server.inGameName || '' });
}
export async function cleanRealCache(settings) {
  try { return await apiPost('/api/clean-cache', { fivemPath: settings.fivemPath }); }
  catch (error) { return { success: false, error: error.message }; }
}
export function generateCitizenFXIni(server) {
  if (!/^\d{4,5}$/.test(String(server?.gameBuild))) throw new Error('ยังไม่ทราบ Game Build จากเซิร์ฟเวอร์');
  return `[Game]\r\nSavedBuildNumber=${server.gameBuild}\r\n`;
}

