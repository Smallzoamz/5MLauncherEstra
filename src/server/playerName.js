import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ClassicLevel } from 'classic-level';
import { validatePlayerName } from '../shared/playerName.js';
import { assertNoLinks, assertTreeNoLinks } from './fileSafety.js';
export const NICKNAME_ORIGIN = 'https://nui-game-internal';
export const NICKNAME_KEY = Buffer.from(`_${NICKNAME_ORIGIN}\x00\x01nickOverride`);
const metaKey = Buffer.from('META:' + NICKNAME_ORIGIN);
export function encodeStorageString(value) {
  const latin = [...value].every(char => char.codePointAt(0) <= 255);
  return Buffer.concat([Buffer.from([latin ? 1 : 0]), Buffer.from(value, latin ? 'latin1' : 'utf16le')]);
}
function varint(value) { const out = []; do { out.push(Number(value & 127n) | (value > 127n ? 128 : 0)); value >>= 7n; } while (value); return Buffer.from(out); }
export function updateStorageMetadata(bytes, delta, now = Date.now()) {
  let offset = 0; const values = new Map();
  function read() { let value = 0n, shift = 0n; while (offset < bytes.length && shift < 70n) { const b = bytes[offset++]; value |= BigInt(b & 127) << shift; if (!(b & 128)) return value; shift += 7n; } throw new Error('รูปแบบ metadata ของ FiveM ไม่รองรับ'); }
  while (offset < bytes.length) { const tag = read(); if (![8n, 16n].includes(tag) || values.has(tag)) throw new Error('รูปแบบ metadata ของ FiveM ไม่รองรับ'); values.set(tag, read()); }
  if (!values.has(8n) || !values.has(16n)) throw new Error('ไม่พบ metadata ของ Name');
  const size = values.get(16n) + BigInt(delta);
  if (size < 0n || size > 100000000n) throw new Error('ขนาดข้อมูล Name ไม่ถูกต้อง');
  return Buffer.concat([Buffer.from([8]), varint((BigInt(now) + 11644473600000n) * 1000n), Buffer.from([16]), varint(size)]);
}
async function resolveLocalStorageLocation(installation) {
  // Modern FiveM (Chromium/CEF) stores Local Storage under Default/, while older builds used nui-storage/ directly.
  const candidates = [
    path.join(installation.data, 'nui-storage', 'Default', 'Local Storage', 'leveldb'),
    path.join(installation.data, 'nui-storage', 'Local Storage', 'leveldb')
  ];
  for (const candidate of candidates) {
    await assertNoLinks(candidate);
    try {
      await assertTreeNoLinks(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('กรุณาเปิด FiveM หนึ่งครั้งก่อนตั้ง Name ผ่านลันเชอร์');
}
export async function applyPlayerName(installation, input) {
  const name = validatePlayerName(input); if (!name) return { changed: false };
  const location = await resolveLocalStorageLocation(installation);
  const db = new ClassicLevel(location, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
  try {
    await db.open();
    const version = await db.get(Buffer.from('VERSION'));
    if (version?.toString() !== '1') throw new Error('รูปแบบข้อมูล Name ของ FiveM ไม่รองรับ จึงยังไม่แก้ไขไฟล์');
    const old = await db.get(NICKNAME_KEY), next = encodeStorageString(name);
    if (old?.equals(next)) return { changed: false, name };
    const metadata = await db.get(metaKey);
    if (!metadata) throw new Error('กรุณาเปิดหน้า Settings ของ FiveM หนึ่งครั้งก่อนตั้ง Name ผ่านลันเชอร์');
    const nextMetadata = updateStorageMetadata(metadata, next.length - (old?.length || 0) + (old ? 0 : Buffer.byteLength('\x01nickOverride')));
    // Save only the affected name and metadata, never copy unrelated account data.
    const backupFolder = path.join(installation.app, 'estra-backups');
    await assertNoLinks(backupFolder); await fs.mkdir(backupFolder, { recursive: true });
    await fs.writeFile(path.join(backupFolder, `nickname-${Date.now()}-${randomUUID()}.json`), JSON.stringify({ origin: NICKNAME_ORIGIN, oldValue: old?.toString('base64') || null, oldMetadata: metadata.toString('base64') }), { flag: 'wx' });
    await db.batch([{ type: 'put', key: NICKNAME_KEY, value: next }, { type: 'put', key: metaKey, value: nextMetadata }], { sync: true });
    if (!(await db.get(NICKNAME_KEY))?.equals(next)) throw new Error('ตรวจสอบ Name หลังบันทึกไม่สำเร็จ');
    return { changed: true, name };
  } catch (error) {
    if (error.code === 'LEVEL_LOCKED' || /lock/i.test(error.cause?.message || '')) throw new Error('FiveM กำลังใช้ข้อมูล Name อยู่ กรุณาปิด FiveM ทุกหน้าต่างก่อนเปลี่ยนชื่อ');
    throw error;
  } finally { await db.close(); }
}
