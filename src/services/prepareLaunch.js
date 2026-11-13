import { launchFiveM, cleanRealCache } from './fivemService.js';
import { apiGet } from './apiService.js';
import { parseTarget } from '../shared/target.js';
import { validatePlayerName } from '../shared/playerName.js';
import presenceService from './presenceService.js';
import audioService from './audioService.js';

// Every UI and Tray launch goes through the same preflight and backend guards.
export async function prepareLaunch(server, settings, dependencies = {}) {
  const { installation = path => apiGet(`/api/installation?path=${encodeURIComponent(path)}`),
    presence = () => presenceService.checkPresence(), mic = audioService,
    cleanCache = cleanRealCache, dispatch = launchFiveM } = dependencies;
  parseTarget(server.ip);
  const requestedName = validatePlayerName(server.inGameName);
  await installation(settings.fivemPath);
  const latest = await presence();
  if (requestedName && latest.fivem?.running !== false) throw new Error('ต้องปิด FiveM ทุกหน้าต่างก่อนใช้ Name ของเมืองนี้ หากเปิด CL2 ให้เว้น Name ว่างเพื่อใช้ชื่อปัจจุบัน');
  if (!server.cl2 && latest.fivem?.running !== false) throw new Error(latest.fivem?.running ? 'FiveM กำลังทำงานอยู่ กรุณาปิดเกมเดิม หรือเปิด CL2 เพื่อเริ่มเกมตัวที่สอง' : 'ตรวจสอบสถานะ FiveM ไม่ได้ กรุณาลองใหม่ก่อนเริ่มเกม');
  if (settings.requireSteamDiscordBeforeLaunch && (!latest.steam.running || !latest.discord.running)) throw new Error('การตั้งค่ากำหนดให้เปิด Steam และ Discord ก่อนเล่น กรุณาเปิดทั้งสองโปรแกรม หรือปิดตัวเลือกนี้ในการตั้งค่า');
  if (settings.checkMicBeforeLaunch) {
    const check = await mic.startMicStream(settings.preferredAudioDeviceId);
    mic.stopMicStream();
    if (!check.success) throw new Error(`เปิดไมโครโฟนไม่ได้: ${check.error} — ตรวจสิทธิ์ไมค์หรือปิดการตรวจในการตั้งค่า`);
  }
  const skipCache = settings.autoClearCacheBeforeLaunch && server.cl2 && latest.fivem?.running !== false;
  if (settings.autoClearCacheBeforeLaunch && !skipCache) {
    const result = await cleanCache(settings); if (!result.success) throw new Error(result.error);
  }
  const result = await dispatch(server, settings);
  if (!result.success) throw new Error(result.error || 'ส่งคำสั่งเปิด FiveM ไม่สำเร็จ');
  return { ...result, message: result.message + (skipCache ? ' • ข้ามการล้างแคชอัตโนมัติ เพื่อรักษาแคชของเกมที่อาจกำลังทำงานอยู่' : '') };
}
