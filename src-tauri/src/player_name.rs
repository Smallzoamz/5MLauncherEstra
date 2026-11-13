use crate::file_safety::{assert_no_links, assert_tree_no_links};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusty_leveldb::{Options, StatusCode, WriteBatch, DB};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const NICKNAME_ORIGIN: &str = "https://nui-game-internal";

pub fn nickname_key() -> Vec<u8> {
    format!("_{NICKNAME_ORIGIN}\x00\x01nickOverride").into_bytes()
}

pub fn meta_key() -> Vec<u8> {
    format!("META:{NICKNAME_ORIGIN}").into_bytes()
}

pub fn validate_player_name(value: Option<&str>) -> Result<String, String> {
    let raw = match value {
        None | Some("") => return Ok(String::new()),
        Some(v) => v,
    };
    if raw.chars().count() > 100
        || raw
            .bytes()
            .any(|b| b < 0x20 || b == 0x7f)
    {
        return Err("Name ต้องไม่เกิน 100 ตัวอักษรและไม่มีอักขระควบคุม".into());
    }
    Ok(raw.trim().to_string())
}

pub fn encode_storage_string(value: &str) -> Vec<u8> {
    let is_latin1 = value.chars().all(|c| (c as u32) <= 255);
    if is_latin1 {
        let mut out = Vec::with_capacity(1 + value.chars().count());
        out.push(1);
        out.extend(value.chars().map(|c| c as u8));
        out
    } else {
        let utf16: Vec<u16> = value.encode_utf16().collect();
        let mut out = Vec::with_capacity(1 + utf16.len() * 2);
        out.push(0);
        for unit in utf16 {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out
    }
}

fn push_varint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            out.push(byte | 0x80);
        } else {
            out.push(byte);
            break;
        }
    }
}

pub fn update_storage_metadata(bytes: &[u8], delta: i64, now_ms: u64) -> Result<Vec<u8>, String> {
    let mut offset = 0usize;
    let mut has_time = false;
    let mut size_val: Option<u64> = None;

    let read_varint = |off: &mut usize| -> Result<u64, String> {
        let mut value = 0u64;
        let mut shift = 0u32;
        while *off < bytes.len() && shift < 70 {
            let b = bytes[*off];
            *off += 1;
            value |= ((b & 0x7f) as u64) << shift;
            if (b & 0x80) == 0 {
                return Ok(value);
            }
            shift += 7;
        }
        Err("รูปแบบ metadata ของ FiveM ไม่รองรับ".into())
    };

    let mut seen_8 = false;
    let mut seen_16 = false;
    while offset < bytes.len() {
        let tag = read_varint(&mut offset)?;
        match tag {
            8 if !seen_8 => {
                seen_8 = true;
                has_time = true;
                let _ = read_varint(&mut offset)?;
            }
            16 if !seen_16 => {
                seen_16 = true;
                size_val = Some(read_varint(&mut offset)?);
            }
            _ => return Err("รูปแบบ metadata ของ FiveM ไม่รองรับ".into()),
        }
    }

    let prev_size = match (has_time, size_val) {
        (true, Some(s)) => s,
        _ => return Err("ไม่พบ metadata ของ Name".into()),
    };

    let next_size_i128 = prev_size as i128 + delta as i128;
    if next_size_i128 < 0 || next_size_i128 > 100_000_000 {
        return Err("ขนาดข้อมูล Name ไม่ถูกต้อง".into());
    }

    let win_time_us = (now_ms as u128 + 11_644_473_600_000u128) * 1000u128;
    let mut out = Vec::with_capacity(24);
    out.push(8);
    push_varint(&mut out, win_time_us as u64);
    out.push(16);
    push_varint(&mut out, next_size_i128 as u64);
    Ok(out)
}

pub fn resolve_local_storage_location(data_dir: &Path) -> Result<PathBuf, String> {
    // Modern FiveM (Chromium/CEF) stores Local Storage under Default/, while older builds used nui-storage/ directly.
    let candidates = [
        data_dir
            .join("nui-storage")
            .join("Default")
            .join("Local Storage")
            .join("leveldb"),
        data_dir
            .join("nui-storage")
            .join("Local Storage")
            .join("leveldb"),
    ];
    for candidate in candidates {
        assert_no_links(&candidate)?;
        match assert_tree_no_links(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("กรุณาเปิด FiveM หนึ่งครั้งก่อนตั้ง Name ผ่านลันเชอร์".into())
}

#[derive(Debug, Serialize)]
pub struct ApplyNameResult {
    pub changed: bool,
    pub name: Option<String>,
}

fn map_leveldb_err(err: rusty_leveldb::Status) -> String {
    if err.code == StatusCode::LockError || err.err.to_lowercase().contains("lock") {
        "FiveM กำลังใช้ข้อมูล Name อยู่ กรุณาปิด FiveM ทุกหน้าต่างก่อนเปลี่ยนชื่อ".into()
    } else {
        format!("เปิดฐานข้อมูล Name ไม่สำเร็จ: {}", err.err)
    }
}

pub fn apply_player_name(app_dir: &Path, data_dir: &Path, input: Option<&str>) -> Result<ApplyNameResult, String> {
    let name = validate_player_name(input)?;
    if name.is_empty() {
        return Ok(ApplyNameResult {
            changed: false,
            name: None,
        });
    }

    let location = resolve_local_storage_location(data_dir)?;
    let mut opt = Options::default();
    opt.create_if_missing = false;

    let mut db = DB::open(&location, opt).map_err(map_leveldb_err)?;

    let result = (|| -> Result<ApplyNameResult, String> {
        let version = db.get(b"VERSION");
        if version.as_deref() != Some(b"1") {
            return Err("รูปแบบข้อมูล Name ของ FiveM ไม่รองรับ จึงยังไม่แก้ไขไฟล์".into());
        }

        let key = nickname_key();
        let old = db.get(&key);
        let next = encode_storage_string(&name);
        if old.as_deref() == Some(next.as_slice()) {
            return Ok(ApplyNameResult {
                changed: false,
                name: Some(name),
            });
        }

        let m_key = meta_key();
        let metadata = db
            .get(&m_key)
            .ok_or_else(|| "กรุณาเปิดหน้า Settings ของ FiveM หนึ่งครั้งก่อนตั้ง Name ผ่านลันเชอร์".to_string())?;

        let old_len = old.as_ref().map(|v| v.len() as i64).unwrap_or(0);
        let key_overhead = if old.is_some() { 0i64 } else { "\x01nickOverride".len() as i64 };
        let delta = next.len() as i64 - old_len + key_overhead;

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let next_metadata = update_storage_metadata(&metadata, delta, now_ms)?;

        let backup_folder = app_dir.join("estra-backups");
        assert_no_links(&backup_folder)?;
        fs::create_dir_all(&backup_folder).map_err(|e| format!("สร้างโฟลเดอร์สำรองข้อมูลไม่สำเร็จ: {e}"))?;
        let backup_path = backup_folder.join(format!("nickname-{now_ms}-{}.json", Uuid::new_v4()));
        let backup_json = serde_json::json!({
            "origin": NICKNAME_ORIGIN,
            "oldValue": old.as_ref().map(|v| BASE64.encode(v)),
            "oldMetadata": BASE64.encode(&metadata)
        });
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup_path)
            .map_err(|e| format!("บันทึกไฟล์สำรองข้อมูล Name ไม่สำเร็จ: {e}"))?;
        f.write_all(backup_json.to_string().as_bytes())
            .map_err(|e| format!("เขียนไฟล์สำรองข้อมูล Name ไม่สำเร็จ: {e}"))?;

        let mut batch = WriteBatch::default();
        batch.put(&key, &next);
        batch.put(&m_key, &next_metadata);
        db.write(batch, true).map_err(map_leveldb_err)?;

        if db.get(&key).as_deref() != Some(next.as_slice()) {
            return Err("ตรวจสอบ Name หลังบันทึกไม่สำเร็จ".into());
        }

        Ok(ApplyNameResult {
            changed: true,
            name: Some(name),
        })
    })();

    let _ = db.close();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusty_leveldb::{compressor, CompressorId};

    #[test]
    fn validates_and_encodes_player_name() {
        assert_eq!(validate_player_name(None).unwrap(), "");
        assert_eq!(validate_player_name(Some(" ทดสอบ 🔮 ")).unwrap(), "ทดสอบ 🔮");
        assert!(validate_player_name(Some("bad\nname")).is_err());
        assert!(validate_player_name(Some(&"a".repeat(101))).is_err());

        let latin = encode_storage_string("Sora");
        assert_eq!(latin, b"\x01Sora");
        let unicode = encode_storage_string("ทดสอบ");
        assert_eq!(unicode[0], 0);
        assert_eq!(unicode.len(), 1 + 5 * 2);
    }

    #[test]
    fn supports_default_profile_and_legacy_fallback() {
        let root = std::env::temp_dir().join(format!("estra-rust-name-{}", Uuid::new_v4()));
        let app_dir = root.join("FiveM.app");
        let data_dir = app_dir.join("data");
        fs::create_dir_all(&data_dir).unwrap();

        assert!(apply_player_name(&app_dir, &data_dir, Some("Sora")).is_err());

        let seed = |db_path: &Path| {
            fs::create_dir_all(db_path).unwrap();
            let mut opt = Options::default();
            opt.create_if_missing = true;
            opt.compressor = compressor::SnappyCompressor::ID;
            let mut db = DB::open(db_path, opt).unwrap();
            let mut batch = WriteBatch::default();
            batch.put(b"VERSION", b"1");
            batch.put(&meta_key(), &[8, 0, 16, 32]);
            db.write(batch, true).unwrap();
            db.close().unwrap();
        };

        let legacy_path = data_dir.join("nui-storage").join("Local Storage").join("leveldb");
        seed(&legacy_path);
        let r1 = apply_player_name(&app_dir, &data_dir, Some("LegacyName")).unwrap();
        assert!(r1.changed);

        let default_path = data_dir
            .join("nui-storage")
            .join("Default")
            .join("Local Storage")
            .join("leveldb");
        seed(&default_path);
        let r2 = apply_player_name(&app_dir, &data_dir, Some("Sora · ทดสอบ")).unwrap();
        assert!(r2.changed);
        let r3 = apply_player_name(&app_dir, &data_dir, Some("Sora · ทดสอบ")).unwrap();
        assert!(!r3.changed);

        let _ = fs::remove_dir_all(&root);
    }
}
