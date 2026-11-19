use crate::file_safety::{assert_no_links, assert_tree_no_links, assert_within, normalize_win_path};
use crate::fivem::resolve_installation;
use crate::presence::{get_process_names, is_fivem_process};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const VAULT_DIR_NAME: &str = ".estra-mod-vault";
const STATE_FILE_NAME: &str = "presets.json";
pub const CLEAN_PURE_PRESET_ID: &str = "clean-pure";
pub const DEFAULT_MODS_PRESET_ID: &str = "current-mods";
const MAX_PRESETS: usize = 20;
const MAX_WALK_ENTRIES: usize = 30_000;
const MANAGED_SUBDIRS: &[&str] = &["mods", "plugins"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPreset {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    built_in: bool,
    #[serde(default)]
    pure_safe: bool,
    #[serde(default)]
    created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultStateFile {
    active_preset_id: String,
    presets: Vec<StoredPreset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModPresetItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub built_in: bool,
    pub pure_safe: bool,
    pub active: bool,
    pub mods_files: usize,
    pub plugins_files: usize,
    pub total_files: usize,
    pub total_bytes: u64,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModPresetsState {
    pub fivem_root: String,
    pub vault_dir: String,
    pub active_preset_id: String,
    pub live_mods_files: usize,
    pub live_plugins_files: usize,
    pub live_total_bytes: u64,
    pub has_active_mods: bool,
    pub presets: Vec<ModPresetItem>,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn ensure_fivem_closed() -> Result<(), String> {
    let names = get_process_names()
        .map_err(|_| "ตรวจสอบสถานะ FiveM ไม่ได้ กรุณาปิดเกมก่อนจัดการโปรไฟล์ม็อด".to_string())?;
    if names.iter().any(|n| is_fivem_process(n)) {
        return Err("กรุณาปิด FiveM ทุกหน้าต่างก่อนสลับหรือแก้ไขโปรไฟล์ม็อด".into());
    }
    Ok(())
}

fn sanitize_preset_id(raw: &str) -> Result<String, String> {
    let clean = raw.trim().to_lowercase();
    if clean.is_empty()
        || clean.len() > 64
        || !clean
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err("รหัสโปรไฟล์ม็อดไม่ถูกต้อง".into());
    }
    Ok(clean)
}

fn sanitize_preset_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 60 {
        return Err("กรุณาระบุชื่อโปรไฟล์ม็อด (1–60 ตัวอักษร)".into());
    }
    if trimmed.bytes().any(|b| b < 0x20) {
        return Err("ชื่อโปรไฟล์มีอักขระที่ไม่อนุญาต".into());
    }
    Ok(trimmed.to_string())
}

fn measure_dir(dir: &Path) -> Result<(usize, u64), String> {
    if !dir.exists() {
        return Ok((0, 0));
    }
    assert_no_links(dir)?;
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut visited = 0usize;

    fn walk(
        path: &Path,
        files: &mut usize,
        bytes: &mut u64,
        visited: &mut usize,
    ) -> Result<(), String> {
        *visited += 1;
        if *visited > MAX_WALK_ENTRIES {
            return Err("พบไฟล์ม็อดมากเกินขอบเขตที่ระบบตรวจสอบได้".into());
        }
        let meta = fs::symlink_metadata(path).map_err(|e| format!("ตรวจไฟล์ม็อดไม่สำเร็จ: {e}"))?;
        if meta.file_type().is_symlink() {
            return Err("พบ symbolic link/junction ในโฟลเดอร์ม็อด จึงไม่ดำเนินการ".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if (meta.file_attributes() & 0x0400) != 0 {
                return Err("พบ junction ในโฟลเดอร์ม็อด จึงไม่ดำเนินการ".into());
            }
        }
        if meta.is_dir() {
            for entry in fs::read_dir(path).map_err(|e| format!("อ่านโฟลเดอร์ม็อดไม่สำเร็จ: {e}"))? {
                let entry = entry.map_err(|e| format!("อ่านรายการไฟล์ไม่สำเร็จ: {e}"))?;
                walk(&entry.path(), files, bytes, visited)?;
            }
        } else if meta.is_file() {
            *files += 1;
            *bytes += meta.len();
        }
        Ok(())
    }

    walk(dir, &mut files, &mut bytes, &mut visited)?;
    Ok((files, bytes))
}

fn copy_dir_no_links(src: &Path, dst: &Path) -> Result<(), String> {
    assert_no_links(src)?;
    assert_no_links(dst)?;
    fs::create_dir_all(dst).map_err(|e| format!("สร้างโฟลเดอร์ปลายทางไม่สำเร็จ: {e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("อ่านโฟลเดอร์ต้นทางไม่สำเร็จ: {e}"))? {
        let entry = entry.map_err(|e| format!("อ่านรายการไฟล์ไม่สำเร็จ: {e}"))?;
        let from = normalize_win_path(&entry.path());
        let meta = fs::symlink_metadata(&from).map_err(|e| format!("ตรวจไฟล์ไม่สำเร็จ: {e}"))?;
        if meta.file_type().is_symlink() {
            return Err("พบ symbolic link ระหว่างคัดลอกโปรไฟล์ม็อด".into());
        }
        let to = normalize_win_path(&dst.join(entry.file_name()));
        assert_within(dst, &to)?;
        if meta.is_dir() {
            copy_dir_no_links(&from, &to)?;
        } else if meta.is_file() {
            fs::copy(&from, &to).map_err(|e| format!("คัดลอกไฟล์ม็อดไม่สำเร็จ: {e}"))?;
        }
    }
    Ok(())
}

/// Instant atomic move on same NTFS drive; falls back to copy+remove if cross-volume.
fn move_dir_safely(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    assert_no_links(src)?;
    assert_tree_no_links(src).map_err(|e| e.to_string())?;
    assert_no_links(dst)?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("สร้างโฟลเดอร์คลังม็อดไม่สำเร็จ: {e}"))?;
    }
    if dst.exists() {
        assert_tree_no_links(dst).map_err(|e| e.to_string())?;
        // Safety guard: refuse to overwrite non-empty destination directory!
        let (existing_files, _) = measure_dir(dst)?;
        if existing_files > 0 {
            return Err(format!(
                "ปลายทางคลังม็อดมีไฟล์ค้างอยู่ ({existing_files} ไฟล์) จึงหยุดเพื่อป้องกันข้อมูลทับกัน"
            ));
        }
        fs::remove_dir_all(dst).map_err(|e| format!("ล้างโฟลเดอร์ว่างปลายทางไม่สำเร็จ: {e}"))?;
    }
    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_dir_no_links(src, dst)?;
            fs::remove_dir_all(src).map_err(|e| format!("ย้ายโฟลเดอร์ม็อดไม่สมบูรณ์: {e}"))?;
            Ok(())
        }
    }
}

fn vault_paths(root: &Path) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let vault_dir = normalize_win_path(&root.join(VAULT_DIR_NAME));
    assert_within(root, &vault_dir)?;
    assert_no_links(&vault_dir)?;
    let presets_dir = normalize_win_path(&vault_dir.join("presets"));
    let state_file = normalize_win_path(&vault_dir.join(STATE_FILE_NAME));
    Ok((vault_dir, presets_dir, state_file))
}

fn preset_slot_dir(presets_dir: &Path, preset_id: &str) -> Result<PathBuf, String> {
    let id = sanitize_preset_id(preset_id)?;
    let slot = normalize_win_path(&presets_dir.join(&id));
    assert_within(presets_dir, &slot)?;
    assert_no_links(&slot)?;
    Ok(slot)
}

fn ensure_vault_initialized(root: &Path, app_dir: &Path) -> Result<VaultStateFile, String> {
    let (vault_dir, presets_dir, state_file) = vault_paths(root)?;
    fs::create_dir_all(&presets_dir).map_err(|e| format!("สร้างคลังโปรไฟล์ม็อดไม่สำเร็จ: {e}"))?;
    assert_no_links(&vault_dir)?;
    assert_no_links(&presets_dir)?;

    let (live_mods, _) = measure_dir(&app_dir.join("mods"))?;
    let (live_plugins, _) = measure_dir(&app_dir.join("plugins"))?;
    let has_live = live_mods + live_plugins > 0;

    let mut state = if state_file.is_file() {
        assert_no_links(&state_file)?;
        let raw = fs::read_to_string(&state_file)
            .map_err(|e| format!("อ่านข้อมูลโปรไฟล์ม็อดไม่สำเร็จ: {e}"))?;
        serde_json::from_str::<VaultStateFile>(&raw).unwrap_or_else(|_| VaultStateFile {
            active_preset_id: if has_live {
                DEFAULT_MODS_PRESET_ID.into()
            } else {
                CLEAN_PURE_PRESET_ID.into()
            },
            presets: vec![],
        })
    } else {
        let now = now_unix_ms();
        let mut presets = vec![StoredPreset {
            id: CLEAN_PURE_PRESET_ID.into(),
            name: "Clean Pure Mode".into(),
            description: "ไม่มีไฟล์ใน mods/ และ plugins/ ปลอดภัยสำหรับเมือง Pure Mode 1 และ 2".into(),
            built_in: true,
            pure_safe: true,
            created_at_ms: now,
        }];
        let active_id = if has_live {
            presets.push(StoredPreset {
                id: DEFAULT_MODS_PRESET_ID.into(),
                name: "ม็อดปัจจุบันของฉัน".into(),
                description: "ชุดม็อดเดิมที่ตรวจพบในโฟลเดอร์ FiveM ของคุณ".into(),
                built_in: false,
                pure_safe: false,
                created_at_ms: now,
            });
            DEFAULT_MODS_PRESET_ID.into()
        } else {
            CLEAN_PURE_PRESET_ID.into()
        };
        VaultStateFile {
            active_preset_id: active_id,
            presets,
        }
    };

    // Ensure built-in clean-pure always exists.
    if !state.presets.iter().any(|p| p.id == CLEAN_PURE_PRESET_ID) {
        state.presets.insert(
            0,
            StoredPreset {
                id: CLEAN_PURE_PRESET_ID.into(),
                name: "Clean Pure Mode".into(),
                description: "ไม่มีไฟล์ใน mods/ และ plugins/ ปลอดภัยสำหรับเมือง Pure Mode 1 และ 2".into(),
                built_in: true,
                pure_safe: true,
                created_at_ms: now_unix_ms(),
            },
        );
    }

    // If active preset is clean-pure but user manually dropped files into mods/plugins,
    // reflect that honestly by ensuring a backup preset exists (do not lose files!).
    if !state.presets.iter().any(|p| p.id == state.active_preset_id) {
        state.active_preset_id = CLEAN_PURE_PRESET_ID.into();
    }

    write_vault_state(&state_file, &state)?;
    Ok(state)
}

fn write_vault_state(state_file: &Path, state: &VaultStateFile) -> Result<(), String> {
    assert_no_links(state_file)?;
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("บันทึกสถานะโปรไฟล์ม็อดไม่สำเร็จ: {e}"))?;
    fs::write(state_file, json).map_err(|e| format!("เขียนไฟล์สถานะโปรไฟล์ม็อดไม่สำเร็จ: {e}"))
}

fn build_state_view(root: &Path, app_dir: &Path, state: &VaultStateFile) -> Result<ModPresetsState, String> {
    let (vault_dir, presets_dir, _) = vault_paths(root)?;
    let (live_mods_files, live_mods_bytes) = measure_dir(&app_dir.join("mods"))?;
    let (live_plugins_files, live_plugins_bytes) = measure_dir(&app_dir.join("plugins"))?;
    let live_total_bytes = live_mods_bytes + live_plugins_bytes;

    let mut items = Vec::with_capacity(state.presets.len());
    for p in &state.presets {
        let is_active = p.id == state.active_preset_id;
        let (mods_files, mods_bytes, plugins_files, plugins_bytes) = if is_active {
            (live_mods_files, live_mods_bytes, live_plugins_files, live_plugins_bytes)
        } else {
            let slot = preset_slot_dir(&presets_dir, &p.id)?;
            let (mf, mb) = measure_dir(&slot.join("mods"))?;
            let (pf, pb) = measure_dir(&slot.join("plugins"))?;
            (mf, mb, pf, pb)
        };
        let total_files = mods_files + plugins_files;
        items.push(ModPresetItem {
            id: p.id.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            built_in: p.built_in,
            pure_safe: p.id == CLEAN_PURE_PRESET_ID || total_files == 0,
            active: is_active,
            mods_files,
            plugins_files,
            total_files,
            total_bytes: mods_bytes + plugins_bytes,
            created_at_ms: p.created_at_ms,
        });
    }

    Ok(ModPresetsState {
        fivem_root: root.to_string_lossy().into_owned(),
        vault_dir: vault_dir.to_string_lossy().into_owned(),
        active_preset_id: state.active_preset_id.clone(),
        live_mods_files,
        live_plugins_files,
        live_total_bytes,
        has_active_mods: live_mods_files + live_plugins_files > 0,
        presets: items,
    })
}

pub fn get_mod_presets_in_dirs(root: &Path, app_dir: &Path) -> Result<ModPresetsState, String> {
    assert_no_links(root)?;
    assert_no_links(app_dir)?;
    let state = ensure_vault_initialized(root, app_dir)?;
    build_state_view(root, app_dir, &state)
}

pub fn create_mod_preset_in_dirs(
    root: &Path,
    app_dir: &Path,
    name: &str,
    description: &str,
    clone_from_live: bool,
) -> Result<ModPresetsState, String> {
    let clean_name = sanitize_preset_name(name)?;
    let clean_desc: String = description.trim().chars().take(180).collect();
    let (_, presets_dir, state_file) = vault_paths(root)?;
    let mut state = ensure_vault_initialized(root, app_dir)?;

    if state.presets.len() >= MAX_PRESETS {
        return Err(format!("สร้างโปรไฟล์ม็อดได้สูงสุด {MAX_PRESETS} โปรไฟล์"));
    }

    let id = format!("preset-{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    let slot = preset_slot_dir(&presets_dir, &id)?;
    fs::create_dir_all(slot.join("mods")).map_err(|e| format!("สร้างโฟลเดอร์ mods ไม่สำเร็จ: {e}"))?;
    fs::create_dir_all(slot.join("plugins")).map_err(|e| format!("สร้างโฟลเดอร์ plugins ไม่สำเร็จ: {e}"))?;

    if clone_from_live {
        for sub in MANAGED_SUBDIRS {
            let live_sub = app_dir.join(sub);
            if live_sub.is_dir() {
                copy_dir_no_links(&live_sub, &slot.join(sub))?;
            }
        }
    }

    state.presets.push(StoredPreset {
        id,
        name: clean_name,
        description: clean_desc,
        built_in: false,
        pure_safe: !clone_from_live,
        created_at_ms: now_unix_ms(),
    });
    write_vault_state(&state_file, &state)?;
    build_state_view(root, app_dir, &state)
}

pub fn switch_mod_preset_in_dirs(
    root: &Path,
    app_dir: &Path,
    target_preset_id: &str,
) -> Result<ModPresetsState, String> {
    let target_id = sanitize_preset_id(target_preset_id)?;
    let (_, presets_dir, state_file) = vault_paths(root)?;
    let mut state = ensure_vault_initialized(root, app_dir)?;

    if !state.presets.iter().any(|p| p.id == target_id) {
        return Err("ไม่พบโปรไฟล์ม็อดที่เลือก".into());
    }

    // Check live mods/plugins first.
    let (live_mods_files, _) = measure_dir(&app_dir.join("mods"))?;
    let (live_plugins_files, _) = measure_dir(&app_dir.join("plugins"))?;
    let live_has_files = live_mods_files + live_plugins_files > 0;

    if state.active_preset_id == target_id {
        // Special case: user asked for clean-pure while clean-pure was already marked active,
        // yet user manually added files into FiveM.app/mods or plugins -> safely archive them first!
        if target_id == CLEAN_PURE_PRESET_ID && live_has_files {
            let backup_id = format!(
                "backup-{}",
                &uuid::Uuid::new_v4().simple().to_string()[..8]
            );
            let backup_slot = preset_slot_dir(&presets_dir, &backup_id)?;
            fs::create_dir_all(&backup_slot)
                .map_err(|e| format!("สร้างโฟลเดอร์สำรองม็อดไม่สำเร็จ: {e}"))?;
            for sub in MANAGED_SUBDIRS {
                let live_sub = app_dir.join(sub);
                if live_sub.exists() {
                    move_dir_safely(&live_sub, &backup_slot.join(sub))?;
                }
            }
            state.presets.push(StoredPreset {
                id: backup_id,
                name: "สำรองม็อดอัตโนมัติ".into(),
                description: "ไฟล์ม็อดที่ถูกเก็บอัตโนมัติก่อนสลับเป็น Clean Pure Mode".into(),
                built_in: false,
                pure_safe: false,
                created_at_ms: now_unix_ms(),
            });
            write_vault_state(&state_file, &state)?;
        }
        return build_state_view(root, app_dir, &state);
    }

    // Step 1: Determine where to park current live mods/plugins (NEVER lose user files).
    let park_id = if state.active_preset_id == CLEAN_PURE_PRESET_ID && live_has_files {
        // Never stash files into clean-pure slot; create an auto-backup preset instead!
        let backup_id = format!(
            "backup-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..8]
        );
        state.presets.push(StoredPreset {
            id: backup_id.clone(),
            name: "สำรองม็อดอัตโนมัติ".into(),
            description: "ไฟล์ม็อดที่ถูกเก็บอัตโนมัติระหว่างสลับโปรไฟล์".into(),
            built_in: false,
            pure_safe: false,
            created_at_ms: now_unix_ms(),
        });
        backup_id
    } else {
        state.active_preset_id.clone()
    };

    if park_id != CLEAN_PURE_PRESET_ID {
        let park_slot = preset_slot_dir(&presets_dir, &park_id)?;
        fs::create_dir_all(&park_slot).map_err(|e| format!("เตรียมช่องเก็บม็อดเดิมไม่สำเร็จ: {e}"))?;
        for sub in MANAGED_SUBDIRS {
            let live_sub = app_dir.join(sub);
            if live_sub.exists() {
                move_dir_safely(&live_sub, &park_slot.join(sub))?;
            }
        }
    } else {
        // clean-pure has no files; remove empty dirs if any.
        for sub in MANAGED_SUBDIRS {
            let live_sub = app_dir.join(sub);
            if live_sub.exists() {
                let (cnt, _) = measure_dir(&live_sub)?;
                if cnt == 0 {
                    let _ = fs::remove_dir_all(&live_sub);
                }
            }
        }
    }

    // Step 2: Move target preset's mods/plugins into FiveM.app (unless target is clean-pure).
    if target_id != CLEAN_PURE_PRESET_ID {
        let target_slot = preset_slot_dir(&presets_dir, &target_id)?;
        for sub in MANAGED_SUBDIRS {
            let stored_sub = target_slot.join(sub);
            if stored_sub.exists() {
                let (cnt, _) = measure_dir(&stored_sub)?;
                if cnt > 0 {
                    move_dir_safely(&stored_sub, &app_dir.join(sub))?;
                }
            }
        }
    }

    state.active_preset_id = target_id;
    write_vault_state(&state_file, &state)?;
    build_state_view(root, app_dir, &state)
}

pub fn delete_mod_preset_in_dirs(
    root: &Path,
    app_dir: &Path,
    preset_id: &str,
) -> Result<ModPresetsState, String> {
    let target_id = sanitize_preset_id(preset_id)?;
    if target_id == CLEAN_PURE_PRESET_ID {
        return Err("ไม่สามารถลบโปรไฟล์มาตรฐาน Clean Pure Mode ได้".into());
    }
    let (_, presets_dir, state_file) = vault_paths(root)?;
    let mut state = ensure_vault_initialized(root, app_dir)?;

    if state.active_preset_id == target_id {
        return Err("ไม่สามารถลบโปรไฟล์ที่กำลังใช้งานอยู่ กรุณาสลับไปโปรไฟล์อื่นก่อน".into());
    }
    let prev_len = state.presets.len();
    state.presets.retain(|p| p.id != target_id);
    if state.presets.len() == prev_len {
        return Err("ไม่พบโปรไฟล์ม็อดที่ต้องการลบ".into());
    }

    let slot = preset_slot_dir(&presets_dir, &target_id)?;
    if slot.exists() {
        assert_tree_no_links(&slot).map_err(|e| e.to_string())?;
        fs::remove_dir_all(&slot).map_err(|e| format!("ลบโฟลเดอร์โปรไฟล์ม็อดไม่สำเร็จ: {e}"))?;
    }

    write_vault_state(&state_file, &state)?;
    build_state_view(root, app_dir, &state)
}

pub fn get_mod_presets_state(fivem_path: &str) -> Result<ModPresetsState, String> {
    let inst = resolve_installation(fivem_path)?;
    get_mod_presets_in_dirs(&inst.root, &inst.app)
}

pub fn create_mod_preset(
    fivem_path: &str,
    name: &str,
    description: &str,
    clone_from_live: bool,
) -> Result<ModPresetsState, String> {
    ensure_fivem_closed()?;
    let inst = resolve_installation(fivem_path)?;
    create_mod_preset_in_dirs(&inst.root, &inst.app, name, description, clone_from_live)
}

pub fn switch_mod_preset(fivem_path: &str, preset_id: &str) -> Result<ModPresetsState, String> {
    ensure_fivem_closed()?;
    let inst = resolve_installation(fivem_path)?;
    switch_mod_preset_in_dirs(&inst.root, &inst.app, preset_id)
}

pub fn delete_mod_preset(fivem_path: &str, preset_id: &str) -> Result<ModPresetsState, String> {
    ensure_fivem_closed()?;
    let inst = resolve_installation(fivem_path)?;
    delete_mod_preset_in_dirs(&inst.root, &inst.app, preset_id)
}

pub fn open_mod_preset_folder(fivem_path: &str, preset_id: &str) -> Result<String, String> {
    let target_id = sanitize_preset_id(preset_id)?;
    let inst = resolve_installation(fivem_path)?;
    let (_, presets_dir, _) = vault_paths(&inst.root)?;
    let state = ensure_vault_initialized(&inst.root, &inst.app)?;

    let dir_to_open = if state.active_preset_id == target_id {
        let mods_dir = inst.app.join("mods");
        if target_id != CLEAN_PURE_PRESET_ID {
            let _ = fs::create_dir_all(&mods_dir);
            mods_dir
        } else {
            inst.app.clone()
        }
    } else {
        let slot = preset_slot_dir(&presets_dir, &target_id)?;
        let mods_dir = slot.join("mods");
        fs::create_dir_all(&mods_dir).map_err(|e| format!("สร้างโฟลเดอร์โปรไฟล์ไม่สำเร็จ: {e}"))?;
        slot
    };

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("explorer.exe")
            .arg(&dir_to_open)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("เปิดโฟลเดอร์ไม่สำเร็จ: {e}"))?;
    }
    Ok(dir_to_open.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_fivem_root(tag: &str) -> (PathBuf, PathBuf) {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("estra_mod_preset_{tag}_{stamp}"));
        let app = root.join("FiveM.app");
        fs::create_dir_all(&app).unwrap();
        (root, app)
    }

    #[test]
    fn preserves_existing_mods_and_switches_cleanly_roundtrip() {
        let (root, app) = temp_fivem_root("roundtrip");
        fs::create_dir_all(app.join("mods")).unwrap();
        fs::write(app.join("mods").join("nve_roads.rpf"), b"fake-rpf-data").unwrap();
        fs::create_dir_all(app.join("plugins")).unwrap();
        fs::write(app.join("plugins").join("reshade.asi"), b"fake-asi").unwrap();

        let initial = get_mod_presets_in_dirs(&root, &app).unwrap();
        assert_eq!(initial.active_preset_id, DEFAULT_MODS_PRESET_ID);
        assert!(initial.has_active_mods);
        assert_eq!(initial.live_mods_files, 1);
        assert_eq!(initial.live_plugins_files, 1);

        // Switch to Clean Pure Mode
        let clean = switch_mod_preset_in_dirs(&root, &app, CLEAN_PURE_PRESET_ID).unwrap();
        assert_eq!(clean.active_preset_id, CLEAN_PURE_PRESET_ID);
        assert!(!clean.has_active_mods);
        assert!(!app.join("mods").exists());
        assert!(!app.join("plugins").exists());

        // Switch back to current-mods — files must be 100% intact!
        let restored = switch_mod_preset_in_dirs(&root, &app, DEFAULT_MODS_PRESET_ID).unwrap();
        assert_eq!(restored.active_preset_id, DEFAULT_MODS_PRESET_ID);
        assert!(restored.has_active_mods);
        assert_eq!(
            fs::read(app.join("mods").join("nve_roads.rpf")).unwrap(),
            b"fake-rpf-data"
        );
        assert_eq!(
            fs::read(app.join("plugins").join("reshade.asi")).unwrap(),
            b"fake-asi"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn manual_files_added_while_clean_pure_are_backed_up_never_deleted() {
        let (root, app) = temp_fivem_root("backup");
        let s0 = get_mod_presets_in_dirs(&root, &app).unwrap();
        assert_eq!(s0.active_preset_id, CLEAN_PURE_PRESET_ID);

        // User manually drops a mod file while clean-pure is active
        fs::create_dir_all(app.join("mods")).unwrap();
        fs::write(app.join("mods").join("soundpack.rpf"), b"sound-bytes").unwrap();

        let s1 = switch_mod_preset_in_dirs(&root, &app, CLEAN_PURE_PRESET_ID).unwrap();
        assert_eq!(s1.active_preset_id, CLEAN_PURE_PRESET_ID);
        assert!(!s1.has_active_mods);
        assert!(s1.presets.iter().any(|p| p.id.starts_with("backup-") && p.mods_files == 1));

        let _ = fs::remove_dir_all(&root);
    }
}
