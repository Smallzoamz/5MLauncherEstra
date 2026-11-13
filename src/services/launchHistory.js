import { parseTarget } from '../shared/target.js';

export const HISTORY_KEY = 'fivem_launcher_launch_history_v1';
export const HISTORY_LIMIT = 50;
const clean = (value, limit) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, limit) : '';
const states = ['preparing', 'sent', 'failed', 'interrupted'];
function normalize(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id || !states.includes(entry.status) || !Number.isFinite(Date.parse(entry.startedAt))) return null;
  if (!entry.city || typeof entry.city.id !== 'string' || typeof entry.city.name !== 'string' || typeof entry.city.ip !== 'string') return null;
  return { id: clean(entry.id, 100), startedAt: new Date(entry.startedAt).toISOString(),
    finishedAt: Number.isFinite(Date.parse(entry.finishedAt)) ? new Date(entry.finishedAt).toISOString() : null,
    city: { id: clean(entry.city.id, 100), name: clean(entry.city.name, 100), ip: clean(entry.city.ip, 512), cl2: entry.city.cl2 === true },
    status: entry.status, error: clean(entry.error, 500) };
}
export function findHistoryCity(entry, servers) {
  if (!entry) return null;
  try {
    const endpoint = parseTarget(entry.city.ip).address;
    return servers.find(server => server.id === entry.city.id && parseTarget(server.ip).address === endpoint) || null;
  } catch { return null; }
}
export function latestHistoryCity(entries, servers) {
  // Do not silently fall back to an older city if the most recent one was removed.
  return findHistoryCity(entries.find(entry => entry.status === 'sent'), servers);
}
export function createLaunchHistory(storage) {
  let entries = [], error = '';
  const listeners = new Set();
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (raw) {
      if (raw.length > 200000) throw Error('oversized');
      const data = JSON.parse(raw); if (!Array.isArray(data)) throw Error('invalid');
      const ids = new Set();
      entries = data.map(normalize).filter(entry => entry && !ids.has(entry.id) && ids.add(entry.id)).slice(0, HISTORY_LIMIT)
        .map(entry => entry.status === 'preparing' ? { ...entry, status: 'interrupted' } : entry);
    }
  } catch { error = 'อ่านประวัติเดิมไม่ได้ ประวัติใหม่จะเริ่มจากรอบนี้'; }
  let snapshot = { entries, error };
  const publish = () => {
    try { storage.setItem(HISTORY_KEY, JSON.stringify(entries)); error = ''; }
    catch { error = 'บันทึกประวัติไม่ได้ รายการรอบนี้อาจหายเมื่อปิดลันเชอร์'; }
    snapshot = { entries, error }; listeners.forEach(listener => listener(snapshot));
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    begin: city => {
      const id = crypto.randomUUID();
      const entry = normalize({ id, startedAt: new Date().toISOString(), city, status: 'preparing' });
      if (!entry) throw Error('ข้อมูลเมืองสำหรับประวัติไม่ถูกต้อง');
      entries = [entry, ...entries].slice(0, HISTORY_LIMIT); publish(); return id;
    },
    finish: (id, status, detail = '') => {
      if (!['sent', 'failed'].includes(status)) throw Error('Invalid launch outcome');
      entries = entries.map(entry => entry.id === id && entry.status === 'preparing' ? { ...entry, status, error: clean(detail, 500), finishedAt: new Date().toISOString() } : entry);
      publish();
    },
    clear: () => { entries = []; publish(); }
  };
}
