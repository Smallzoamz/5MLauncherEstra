use crate::file_safety::{assert_no_links, assert_tree_no_links, assert_within, normalize_win_path};
use crate::overlay::{push_overlay_notification, OverlayManager, OverlayNotificationPayload};
use crate::presence::get_fivem_sessions;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const CRP_OVERLAY_LABEL: &str = "crp-overlay";
pub const CRP_ADDON_ID: &str = "fivem-crp-srp-overlay";
pub const CRP_ADDON_VERSION: &str = "1.0.0";
const CRP_WIDTH: f64 = 408.0;
const CRP_HEIGHT: f64 = 590.0;
const CRP_MARGIN: i32 = 18;
const MANIFEST_FILE: &str = "manifest.json";
const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrpAddonManifest {
    pub id: String,
    pub version: String,
    pub installed_at: u64,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrpScheduleItem {
    pub id: String,
    pub title: String,
    #[serde(default = "default_schedule_category")]
    pub category: String,
    #[serde(default = "default_schedule_type")]
    pub schedule_type: String,
    #[serde(default)]
    pub days_of_week: Vec<u8>,
    #[serde(default)]
    pub date: String,
    #[serde(default = "default_time")]
    pub time: String,
    #[serde(default = "default_remind_before")]
    pub remind_before_minutes: u16,
    #[serde(default = "default_true")]
    pub notify_at_start: bool,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrpQuickCommand {
    pub id: String,
    pub label: String,
    pub command: String,
    #[serde(default = "default_cmd_mode")]
    pub mode: String,
    #[serde(default = "default_cmd_category")]
    pub category: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub built_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrpOverlayConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_hotkey")]
    pub toggle_hotkey: String,
    #[serde(default = "default_position")]
    pub position: String,
    #[serde(default)]
    pub only_in_game: bool,
    #[serde(default = "default_true")]
    pub auto_hide_on_copy: bool,
    #[serde(default = "default_true")]
    pub show_schedule_toasts: bool,
    #[serde(default = "default_true")]
    pub play_alert_sound: bool,
    #[serde(default = "default_roll_command")]
    pub roll_command: String,
    #[serde(default = "default_roll_count")]
    pub roll_count: u8,
    #[serde(default)]
    pub schedules: Vec<CrpScheduleItem>,
    #[serde(default = "default_quick_commands")]
    pub commands: Vec<CrpQuickCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrpAddonState {
    pub installed: bool,
    pub manifest: Option<CrpAddonManifest>,
    pub config: CrpOverlayConfig,
    pub overlay_visible: bool,
    pub install_dir: String,
}

fn default_true() -> bool {
    true
}
fn default_schedule_category() -> String {
    "event".to_string()
}
fn default_schedule_type() -> String {
    "weekly".to_string()
}
fn default_time() -> String {
    "20:00".to_string()
}
fn default_remind_before() -> u16 {
    5
}
fn default_cmd_mode() -> String {
    "chat".to_string()
}
fn default_cmd_category() -> String {
    "custom".to_string()
}
fn default_hotkey() -> String {
    "Alt+O".to_string()
}
fn default_position() -> String {
    "top-right".to_string()
}
fn default_roll_command() -> String {
    "roll".to_string()
}
fn default_roll_count() -> u8 {
    4
}

pub fn default_quick_commands() -> Vec<CrpQuickCommand> {
    vec![
        CrpQuickCommand {
            id: "builtin-reloadmap".into(),
            label: "รีโหลดแมพ".into(),
            command: "/reloadmap".into(),
            mode: "chat".into(),
            category: "fix".into(),
            description: "ใช้เมื่อแมพไม่โหลด พื้นหาย หรือฉากค้าง".into(),
            built_in: true,
        },
        CrpQuickCommand {
            id: "builtin-reloadskin".into(),
            label: "รีโหลดสกิน / ตัวละคร".into(),
            command: "/reloadskin".into(),
            mode: "chat".into(),
            category: "fix".into(),
            description: "ใช้เมื่อเสื้อผ้าบั๊ก ทรงผมหาย หรือโมเดลตัวละครโหลดไม่ครบ".into(),
            built_in: true,
        },
        CrpQuickCommand {
            id: "builtin-voice-music".into(),
            label: "โหมดร้องเพลง / ดนตรี (Music)".into(),
            command: "setvoiceintent music".into(),
            mode: "f8".into(),
            category: "voice".into(),
            description: "ปรับไมค์เป็นโหมดดนตรีผ่าน F8 ให้เสียงร้องหรือเครื่องดนตรีชัดขึ้น".into(),
            built_in: true,
        },
        CrpQuickCommand {
            id: "builtin-voice-speech".into(),
            label: "กลับโหมดพูดปกติ (Speech)".into(),
            command: "setvoiceintent speech".into(),
            mode: "f8".into(),
            category: "voice".into(),
            description: "ปรับไมค์กลับมาเป็นโหมดพูดคุยปกติผ่าน F8 หลังร้องเพลงเสร็จ".into(),
            built_in: true,
        },
    ]
}

impl Default for CrpOverlayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            toggle_hotkey: default_hotkey(),
            position: default_position(),
            only_in_game: false,
            auto_hide_on_copy: true,
            show_schedule_toasts: true,
            play_alert_sound: true,
            roll_command: default_roll_command(),
            roll_count: default_roll_count(),
            schedules: Vec::new(),
            commands: default_quick_commands(),
        }
    }
}

pub fn parse_crp_hotkey(raw: &str) -> Result<(bool, bool, bool, i32, &'static str), String> {
    let normalized = raw.trim().to_ascii_uppercase().replace(' ', "");
    match normalized.as_str() {
        "" | "ALT+O" => Ok((false, true, false, 0x4F, "Alt+O")),
        "CTRL+SHIFT+O" => Ok((true, false, true, 0x4F, "Ctrl+Shift+O")),
        "INSERT" | "INS" => Ok((false, false, false, 0x2D, "Insert")),
        "HOME" => Ok((false, false, false, 0x24, "Home")),
        "F7" => Ok((false, false, false, 0x76, "F7")),
        "F9" => Ok((false, false, false, 0x78, "F9")),
        _ => Err("คีย์ลัด Overlay รองรับ Alt+O, Ctrl+Shift+O, Insert, Home, F7 และ F9".into()),
    }
}

pub fn normalize_crp_position(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "top-left" | "topleft" => "top-left".to_string(),
        "bottom-left" | "bottomleft" => "bottom-left".to_string(),
        "bottom-right" | "bottomright" => "bottom-right".to_string(),
        _ => "top-right".to_string(),
    }
}

fn sanitize_time_str(raw: &str) -> String {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    if parts.len() == 2 {
        if let (Ok(h), Ok(m)) = (parts[0].parse::<u8>(), parts[1].parse::<u8>()) {
            if h < 24 && m < 60 {
                return format!("{h:02}:{m:02}");
            }
        }
    }
    "20:00".to_string()
}

fn sanitize_date_str(raw: &str) -> String {
    let parts: Vec<&str> = raw.trim().split('-').collect();
    if parts.len() == 3 {
        if let (Ok(y), Ok(m), Ok(d)) = (
            parts[0].parse::<i32>(),
            parts[1].parse::<u32>(),
            parts[2].parse::<u32>(),
        ) {
            if (2000..=2100).contains(&y) && (1..=12).contains(&m) && (1..=31).contains(&d) {
                return format!("{y:04}-{m:02}-{d:02}");
            }
        }
    }
    String::new()
}

pub fn sanitize_crp_config(mut cfg: CrpOverlayConfig) -> CrpOverlayConfig {
    cfg.toggle_hotkey = parse_crp_hotkey(&cfg.toggle_hotkey)
        .map(|(_, _, _, _, canon)| canon.to_string())
        .unwrap_or_else(|_| default_hotkey());
    cfg.position = normalize_crp_position(&cfg.position);
    let clean_roll: String = cfg
        .roll_command
        .replace(['\r', '\n', ';'], " ")
        .trim()
        .trim_start_matches('/')
        .chars()
        .take(60)
        .collect();
    cfg.roll_command = if clean_roll.is_empty() {
        "roll".to_string()
    } else {
        clean_roll
    };
    cfg.roll_count = cfg.roll_count.clamp(1, 20);

    cfg.schedules = cfg
        .schedules
        .into_iter()
        .filter_map(|mut item| {
            item.title = item.title.trim().chars().take(80).collect();
            if item.title.is_empty() {
                return None;
            }
            item.id = item.id.trim().chars().take(64).collect();
            if item.id.is_empty() {
                item.id = format!("sch-{}", uuid::Uuid::new_v4());
            }
            item.category = match item.category.as_str() {
                "class" | "event" | "story" | "other" => item.category,
                _ => "event".to_string(),
            };
            item.schedule_type = if item.schedule_type == "once" {
                "once".to_string()
            } else {
                "weekly".to_string()
            };
            item.time = sanitize_time_str(&item.time);
            item.date = if item.schedule_type == "once" {
                sanitize_date_str(&item.date)
            } else {
                String::new()
            };
            let mut days: Vec<u8> = item.days_of_week.into_iter().filter(|&d| d <= 6).collect();
            days.sort_unstable();
            days.dedup();
            if item.schedule_type == "weekly" && days.is_empty() {
                days = vec![0, 1, 2, 3, 4, 5, 6];
            }
            item.days_of_week = days;
            item.remind_before_minutes = item.remind_before_minutes.min(120);
            item.location = item.location.trim().chars().take(60).collect();
            item.note = item.note.trim().chars().take(140).collect();
            Some(item)
        })
        .take(100)
        .collect();

    cfg.commands = cfg
        .commands
        .into_iter()
        .filter_map(|mut cmd| {
            cmd.label = cmd.label.trim().chars().take(60).collect();
            cmd.command = cmd
                .command
                .replace(['\r', '\n'], " ")
                .trim()
                .chars()
                .take(200)
                .collect();
            if cmd.label.is_empty() || cmd.command.is_empty() {
                return None;
            }
            cmd.id = cmd.id.trim().chars().take(64).collect();
            if cmd.id.is_empty() {
                cmd.id = format!("cmd-{}", uuid::Uuid::new_v4());
            }
            cmd.mode = if cmd.mode == "f8" {
                "f8".to_string()
            } else {
                "chat".to_string()
            };
            cmd.category = match cmd.category.as_str() {
                "fix" | "voice" | "rp" | "custom" => cmd.category,
                _ => "custom".to_string(),
            };
            cmd.description = cmd.description.trim().chars().take(140).collect();
            Some(cmd)
        })
        .take(120)
        .collect();

    cfg
}

pub fn resolve_addon_dir_from_base(base: &Path) -> Result<PathBuf, String> {
    let addons_root = normalize_win_path(&base.join("addons"));
    let target = normalize_win_path(&addons_root.join(CRP_ADDON_ID));
    assert_within(&addons_root, &target)?;
    assert_no_links(&target)?;
    Ok(target)
}

fn resolve_addon_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("ไม่สามารถระบุโฟลเดอร์โปรแกรมได้: {e}"))?;
    resolve_addon_dir_from_base(&base)
}

fn atomic_write_json<T: Serialize>(dir: &Path, filename: &str, value: &T) -> Result<(), String> {
    assert_no_links(dir)?;
    fs::create_dir_all(dir).map_err(|e| format!("สร้างโฟลเดอร์ฟีเจอร์เสริมไม่สำเร็จ: {e}"))?;
    let target = normalize_win_path(&dir.join(filename));
    assert_within(dir, &target)?;
    assert_no_links(&target)?;
    let tmp = normalize_win_path(&dir.join(format!("{filename}.tmp")));
    assert_within(dir, &tmp)?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|e| format!("แปลงข้อมูล JSON ไม่สำเร็จ: {e}"))?;
    fs::write(&tmp, raw).map_err(|e| format!("เขียนไฟล์ฟีเจอร์เสริมไม่สำเร็จ: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("บันทึกไฟล์ฟีเจอร์เสริมไม่สำเร็จ: {e}"))?;
    Ok(())
}

pub fn load_addon_from_dir(dir: &Path) -> Result<(bool, Option<CrpAddonManifest>, CrpOverlayConfig), String> {
    if !dir.exists() {
        return Ok((false, None, CrpOverlayConfig::default()));
    }
    assert_no_links(dir)?;
    let manifest_path = normalize_win_path(&dir.join(MANIFEST_FILE));
    if !manifest_path.is_file() {
        return Ok((false, None, CrpOverlayConfig::default()));
    }
    assert_no_links(&manifest_path)?;
    let manifest_raw = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("อ่านข้อมูลฟีเจอร์เสริมไม่สำเร็จ: {e}"))?;
    let manifest: CrpAddonManifest = serde_json::from_str(&manifest_raw)
        .map_err(|e| format!("ข้อมูล manifest ฟีเจอร์เสริมเสียหาย: {e}"))?;

    let config_path = normalize_win_path(&dir.join(CONFIG_FILE));
    let config = if config_path.is_file() && assert_no_links(&config_path).is_ok() {
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str::<CrpOverlayConfig>(&s).ok())
            .map(sanitize_crp_config)
            .unwrap_or_default()
    } else {
        CrpOverlayConfig::default()
    };

    Ok((true, Some(manifest), config))
}

pub fn install_addon_in_dir(dir: &Path) -> Result<(CrpAddonManifest, CrpOverlayConfig), String> {
    assert_no_links(dir)?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let manifest = CrpAddonManifest {
        id: CRP_ADDON_ID.to_string(),
        version: CRP_ADDON_VERSION.to_string(),
        installed_at: now_ms,
        enabled: true,
    };
    let config = CrpOverlayConfig::default();
    atomic_write_json(dir, MANIFEST_FILE, &manifest)?;
    atomic_write_json(dir, CONFIG_FILE, &config)?;
    Ok((manifest, config))
}

pub fn uninstall_addon_in_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    assert_no_links(dir)?;
    assert_tree_no_links(dir).map_err(|e| e.to_string())?;
    fs::remove_dir_all(dir).map_err(|e| format!("ลบไฟล์ฟีเจอร์เสริมไม่สำเร็จ: {e}"))?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalDateTime {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub dow: u8, // 0=Sunday..6=Saturday
    pub hour: u8,
    pub minute: u8,
}

fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = (y as i64) - if m <= 2 { 1 } else { 0 };
    let m = m as i64;
    let d = d as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (year, m as u8, d as u8)
}

fn day_of_week_from_days(z: i64) -> u8 {
    // 1970-01-01 (z=0) was Thursday (4)
    ((z + 4).rem_euclid(7)) as u8
}

pub fn add_days_to_date(year: i32, month: u8, day: u8, delta_days: i64) -> (i32, u8, u8, u8) {
    let z = days_from_civil(year, month as u32, day as u32) + delta_days;
    let (y, m, d) = civil_from_days(z);
    let dow = day_of_week_from_days(z);
    (y, m, d, dow)
}

pub fn shift_minutes(dt: LocalDateTime, delta_minutes: i64) -> LocalDateTime {
    let base_days = days_from_civil(dt.year, dt.month as u32, dt.day as u32);
    let total_mins = (dt.hour as i64) * 60 + (dt.minute as i64) + delta_minutes;
    let day_shift = total_mins.div_euclid(1440);
    let rem_mins = total_mins.rem_euclid(1440);
    let new_days = base_days + day_shift;
    let (y, m, d) = civil_from_days(new_days);
    LocalDateTime {
        year: y,
        month: m,
        day: d,
        dow: day_of_week_from_days(new_days),
        hour: (rem_mins / 60) as u8,
        minute: (rem_mins % 60) as u8,
    }
}

fn format_minute_key(dt: LocalDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}",
        dt.year, dt.month, dt.day, dt.hour, dt.minute
    )
}

pub fn build_schedule_overlay_payload(item: &CrpScheduleItem, phase: &str) -> OverlayNotificationPayload {
    let (cat_label, initials, accent) = match item.category.as_str() {
        "class" => ("ตารางเรียน", "CLS", "#38bdf8"),
        "story" => ("นัดหมาย RP", "RP", "#a855f7"),
        "other" => ("แจ้งเตือน", "ALM", "#22c55e"),
        _ => ("Event", "EVT", "#f59e0b"),
    };
    let badge = if phase == "pre" && item.remind_before_minutes > 0 {
        format!("{cat_label} · อีก {} นาที", item.remind_before_minutes)
    } else {
        format!("{cat_label} · ถึงเวลาแล้ว")
    };
    let mut parts = Vec::new();
    if !item.location.is_empty() {
        parts.push(format!("สถานที่: {}", item.location));
    }
    if !item.note.is_empty() {
        parts.push(item.note.clone());
    }
    let subtitle = if parts.is_empty() {
        format!("เวลา {}", item.time)
    } else {
        parts.join(" · ")
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    OverlayNotificationPayload {
        id: format!("crp-sch-{}-{phase}-{now_ms}", item.id),
        kind: "schedule-alert".to_string(),
        badge,
        title: item.title.clone(),
        subtitle,
        detail: item.time.clone(),
        image_url: String::new(),
        initials: initials.to_string(),
        accent_color: accent.to_string(),
        duration_ms: 6500,
    }
}

pub fn evaluate_due_schedules(
    schedules: &[CrpScheduleItem],
    now: LocalDateTime,
    fired_keys: &mut HashSet<String>,
) -> Vec<OverlayNotificationPayload> {
    let mut out = Vec::new();
    let now_key = format_minute_key(now);

    for item in schedules {
        if !item.enabled {
            continue;
        }
        let parts: Vec<&str> = item.time.split(':').collect();
        if parts.len() != 2 {
            continue;
        }
        let (Ok(hh), Ok(mm)) = (parts[0].parse::<u8>(), parts[1].parse::<u8>()) else {
            continue;
        };
        if hh >= 24 || mm >= 60 {
            continue;
        }

        for day_offset in [0_i64, 1_i64] {
            let (oy, om, od, odow) = add_days_to_date(now.year, now.month, now.day, day_offset);
            let occ_iso = format!("{oy:04}-{om:02}-{od:02}");
            let matches_day = if item.schedule_type == "once" {
                item.date == occ_iso
            } else if item.days_of_week.is_empty() {
                true
            } else {
                item.days_of_week.contains(&odow)
            };
            if !matches_day {
                continue;
            }

            let occ = LocalDateTime {
                year: oy,
                month: om,
                day: od,
                dow: odow,
                hour: hh,
                minute: mm,
            };
            let occ_key = format_minute_key(occ);

            if item.remind_before_minutes > 0 {
                let pre = shift_minutes(occ, -(item.remind_before_minutes as i64));
                if format_minute_key(pre) == now_key {
                    let dedup = format!("{}|pre|{occ_key}", item.id);
                    if fired_keys.insert(dedup) {
                        out.push(build_schedule_overlay_payload(item, "pre"));
                    }
                }
            }

            if item.notify_at_start || item.remind_before_minutes == 0 {
                if occ_key == now_key {
                    let dedup = format!("{}|start|{occ_key}", item.id);
                    if fired_keys.insert(dedup) {
                        out.push(build_schedule_overlay_payload(item, "start"));
                    }
                }
            }
        }
    }

    if fired_keys.len() > 1000 {
        fired_keys.clear();
    }
    out
}

#[derive(Clone, Default)]
pub struct CrpOverlayManager {
    installed: Arc<AtomicBool>,
    manifest: Arc<Mutex<Option<CrpAddonManifest>>>,
    config: Arc<Mutex<CrpOverlayConfig>>,
    overlay_visible: Arc<AtomicBool>,
    prev_fg_hwnd: Arc<AtomicIsize>,
    worker_running: Arc<AtomicBool>,
    wake: Arc<(Mutex<()>, Condvar)>,
}

impl CrpOverlayManager {
    pub fn init_from_disk(&self, app: &AppHandle, overlay_mgr: OverlayManager) {
        let Ok(dir) = resolve_addon_dir(app) else {
            return;
        };
        if let Ok((installed, manifest, config)) = load_addon_from_dir(&dir) {
            self.installed.store(installed, Ordering::SeqCst);
            if let Ok(mut guard) = self.manifest.lock() {
                *guard = manifest;
            }
            if let Ok(mut guard) = self.config.lock() {
                *guard = config;
            }
            if installed {
                self.ensure_worker(app, overlay_mgr);
            }
        }
    }

    pub fn snapshot_state(&self, app: Option<&AppHandle>) -> CrpAddonState {
        let install_dir = app
            .and_then(|a| resolve_addon_dir(a).ok())
            .filter(|_| self.installed.load(Ordering::SeqCst))
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();

        CrpAddonState {
            installed: self.installed.load(Ordering::SeqCst),
            manifest: self.manifest.lock().ok().and_then(|g| g.clone()),
            config: self
                .config
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default(),
            overlay_visible: self.overlay_visible.load(Ordering::SeqCst),
            install_dir,
        }
    }

    pub fn snapshot_config(&self) -> CrpOverlayConfig {
        self.config
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn is_installed(&self) -> bool {
        self.installed.load(Ordering::SeqCst)
    }

    fn emit_state(&self, app: &AppHandle) {
        let state = self.snapshot_state(Some(app));
        let _ = app.emit("estra://crp-addon-state", state);
    }

    fn notify_worker(&self) {
        let (lock, cvar) = &*self.wake;
        let _guard = lock.lock();
        cvar.notify_all();
    }

    fn ensure_worker(&self, app: &AppHandle, overlay_mgr: OverlayManager) {
        if !self.installed.load(Ordering::SeqCst) {
            return;
        }
        if !self.worker_running.swap(true, Ordering::SeqCst) {
            start_crp_worker(app.clone(), self.clone(), overlay_mgr);
        } else {
            self.notify_worker();
        }
    }

    pub fn install(&self, app: &AppHandle, overlay_mgr: OverlayManager) -> Result<CrpAddonState, String> {
        let dir = resolve_addon_dir(app)?;
        let (manifest, config) = install_addon_in_dir(&dir)?;
        if let Ok(mut guard) = self.manifest.lock() {
            *guard = Some(manifest);
        }
        if let Ok(mut guard) = self.config.lock() {
            *guard = config;
        }
        self.installed.store(true, Ordering::SeqCst);
        self.overlay_visible.store(false, Ordering::SeqCst);
        self.ensure_worker(app, overlay_mgr);
        self.emit_state(app);
        Ok(self.snapshot_state(Some(app)))
    }

    pub fn uninstall(&self, app: &AppHandle) -> Result<CrpAddonState, String> {
        self.installed.store(false, Ordering::SeqCst);
        self.overlay_visible.store(false, Ordering::SeqCst);
        self.notify_worker();
        hide_crp_overlay_window_internal(app, self, false);

        let app_ui = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(win) = app_ui.get_webview_window(CRP_OVERLAY_LABEL) {
                let _ = win.close();
            }
        });

        let dir = resolve_addon_dir(app)?;
        uninstall_addon_in_dir(&dir)?;
        if let Ok(mut guard) = self.manifest.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.config.lock() {
            *guard = CrpOverlayConfig::default();
        }
        self.emit_state(app);
        Ok(self.snapshot_state(Some(app)))
    }

    pub fn update_config(
        &self,
        app: &AppHandle,
        overlay_mgr: OverlayManager,
        next: CrpOverlayConfig,
    ) -> Result<CrpAddonState, String> {
        if !self.installed.load(Ordering::SeqCst) {
            return Err("กรุณาติดตั้ง FiveM C-RP-SRP Overlay ก่อนปรับตั้งค่า".into());
        }
        let clean = sanitize_crp_config(next);
        let dir = resolve_addon_dir(app)?;
        atomic_write_json(&dir, CONFIG_FILE, &clean)?;

        if let Ok(mut guard) = self.manifest.lock() {
            if let Some(ref mut man) = *guard {
                man.enabled = clean.enabled;
                let _ = atomic_write_json(&dir, MANIFEST_FILE, man);
            }
        }
        if let Ok(mut guard) = self.config.lock() {
            *guard = clean.clone();
        }
        if !clean.enabled && self.overlay_visible.load(Ordering::SeqCst) {
            hide_crp_overlay_window_internal(app, self, false);
        }
        self.ensure_worker(app, overlay_mgr);
        self.emit_state(app);
        Ok(self.snapshot_state(Some(app)))
    }

    pub fn toggle_overlay(&self, app: &AppHandle, desired: Option<bool>) -> Result<bool, String> {
        if !self.installed.load(Ordering::SeqCst) {
            return Err("ยังไม่ได้ติดตั้ง FiveM C-RP-SRP Overlay".into());
        }
        let cfg = self.snapshot_config();
        let currently_visible = app
            .get_webview_window(CRP_OVERLAY_LABEL)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        let target = desired.unwrap_or(!currently_visible);
        if target {
            if !cfg.enabled {
                return Err("กรุณาเปิดใช้งาน FiveM C-RP-SRP Overlay ก่อนเปิดหน้าต่าง".into());
            }
            show_crp_overlay_window_internal(app, self, &cfg.position)?;
            self.overlay_visible.store(true, Ordering::SeqCst);
        } else {
            hide_crp_overlay_window_internal(app, self, true);
            self.overlay_visible.store(false, Ordering::SeqCst);
        }
        self.emit_state(app);
        Ok(target)
    }
}

#[cfg(target_os = "windows")]
mod win_crp {
    use super::{normalize_crp_position, CRP_HEIGHT, CRP_MARGIN, CRP_WIDTH};
    use std::mem::size_of;
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetSystemMetrics, GetWindowLongPtrW, IsWindow, SetForegroundWindow,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SM_CXSCREEN,
        SM_CYSCREEN, SWP_SHOWWINDOW, SW_HIDE, WS_EX_TOOLWINDOW,
    };

    const VK_SHIFT: i32 = 0x10;
    const VK_CONTROL: i32 = 0x11;
    const VK_MENU: i32 = 0x12;

    #[repr(C)]
    #[derive(Default)]
    pub struct SYSTEMTIME {
        pub w_year: u16,
        pub w_month: u16,
        pub w_day_of_week: u16,
        pub w_day: u16,
        pub w_hour: u16,
        pub w_minute: u16,
        pub w_second: u16,
        pub w_milliseconds: u16,
    }

    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vKey: i32) -> i16;
        fn OpenClipboard(hWndNewOwner: isize) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(uFormat: u32, hMem: isize) -> isize;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLocalTime(lpSystemTime: *mut SYSTEMTIME);
        fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> isize;
        fn GlobalLock(hMem: isize) -> *mut u8;
        fn GlobalUnlock(hMem: isize) -> i32;
        fn GlobalFree(hMem: isize) -> isize;
    }

    pub fn current_local_time() -> super::LocalDateTime {
        let mut st = SYSTEMTIME::default();
        unsafe { GetLocalTime(&mut st) };
        super::LocalDateTime {
            year: st.w_year as i32,
            month: st.w_month as u8,
            day: st.w_day as u8,
            dow: st.w_day_of_week as u8,
            hour: st.w_hour as u8,
            minute: st.w_minute as u8,
        }
    }

    pub fn is_hotkey_pressed(ctrl: bool, alt: bool, shift: bool, vk: i32) -> bool {
        if unsafe { GetAsyncKeyState(vk) } >= 0 {
            return false;
        }
        let ctrl_down = unsafe { GetAsyncKeyState(VK_CONTROL) } < 0;
        let alt_down = unsafe { GetAsyncKeyState(VK_MENU) } < 0;
        let shift_down = unsafe { GetAsyncKeyState(VK_SHIFT) } < 0;
        ctrl_down == ctrl && alt_down == alt && shift_down == shift
    }

    pub fn current_foreground_hwnd() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    pub fn restore_foreground_hwnd(raw: isize) {
        if raw == 0 {
            return;
        }
        let hwnd = HWND(raw as *mut std::ffi::c_void);
        unsafe {
            if IsWindow(Some(hwnd)).as_bool() {
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }

    fn active_work_area() -> (i32, i32, i32, i32) {
        let fg = unsafe { GetForegroundWindow() };
        let hmon = unsafe { MonitorFromWindow(fg, MONITOR_DEFAULTTOPRIMARY) };
        if !hmon.0.is_null() {
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                rcMonitor: RECT::default(),
                rcWork: RECT::default(),
                dwFlags: 0,
            };
            if unsafe { GetMonitorInfoW(hmon, &mut info) }.as_bool() {
                let area = if info.rcWork.right > info.rcWork.left
                    && info.rcWork.bottom > info.rcWork.top
                {
                    info.rcWork
                } else {
                    info.rcMonitor
                };
                return (area.left, area.top, area.right, area.bottom);
            }
        }
        let w = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(800);
        let h = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(600);
        (0, 0, w, h)
    }

    pub fn show_interactive_topmost(win: &WebviewWindow, position: &str) {
        let _ = win.set_ignore_cursor_events(false);
        let Ok(hwnd) = win.hwnd() else {
            let _ = win.show();
            let _ = win.set_focus();
            return;
        };
        let target_hwnd = HWND(hwnd.0);
        let scale = win.scale_factor().unwrap_or(1.0);
        let phys_w = (CRP_WIDTH * scale).round() as i32;
        let phys_h = (CRP_HEIGHT * scale).round() as i32;
        let margin = (CRP_MARGIN as f64 * scale).round() as i32;
        let (left, top, right, bottom) = active_work_area();

        let (x, y) = match normalize_crp_position(position).as_str() {
            "top-left" => (left + margin, top + margin),
            "bottom-left" => (left + margin, bottom - phys_h - margin),
            "bottom-right" => (right - phys_w - margin, bottom - phys_h - margin),
            _ => (right - phys_w - margin, top + margin),
        };

        unsafe {
            let ex_style = GetWindowLongPtrW(target_hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                target_hwnd,
                GWL_EXSTYLE,
                ex_style | (WS_EX_TOOLWINDOW.0 as isize),
            );
            let _ = SetWindowPos(
                target_hwnd,
                Some(HWND_TOPMOST),
                x,
                y,
                phys_w,
                phys_h,
                SWP_SHOWWINDOW,
            );
            let _ = SetForegroundWindow(target_hwnd);
        }
        let _ = win.set_focus();
    }

    pub fn hide_overlay(win: &WebviewWindow) {
        if let Ok(hwnd) = win.hwnd() {
            unsafe {
                let _ = ShowWindow(HWND(hwnd.0), SW_HIDE);
            }
        }
        let _ = win.hide();
    }

    pub fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
        let mut wide: Vec<u16> = text.encode_utf16().collect();
        wide.push(0);
        let byte_len = wide.len() * std::mem::size_of::<u16>();

        let hmem = unsafe { GlobalAlloc(GMEM_MOVEABLE, byte_len) };
        if hmem == 0 {
            return Err("ไม่สามารถจองหน่วยความจำ Clipboard ได้".into());
        }
        let ptr = unsafe { GlobalLock(hmem) };
        if ptr.is_null() {
            unsafe { GlobalFree(hmem) };
            return Err("ไม่สามารถเขียนข้อมูลลง Clipboard ได้".into());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr, byte_len);
            GlobalUnlock(hmem);
        }

        if unsafe { OpenClipboard(0) } == 0 {
            unsafe { GlobalFree(hmem) };
            return Err("ไม่สามารถเปิด Clipboard ของ Windows ได้ในขณะนี้".into());
        }
        unsafe { EmptyClipboard() };
        let res = unsafe { SetClipboardData(CF_UNICODETEXT, hmem) };
        unsafe { CloseClipboard() };
        if res == 0 {
            unsafe { GlobalFree(hmem) };
            return Err("คัดลอกข้อความลง Clipboard ไม่สำเร็จ".into());
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod win_crp {
    use tauri::WebviewWindow;

    pub fn current_local_time() -> super::LocalDateTime {
        super::LocalDateTime {
            year: 2026,
            month: 1,
            day: 1,
            dow: 4,
            hour: 0,
            minute: 0,
        }
    }

    pub fn is_hotkey_pressed(_ctrl: bool, _alt: bool, _shift: bool, _vk: i32) -> bool {
        false
    }

    pub fn current_foreground_hwnd() -> isize {
        0
    }

    pub fn restore_foreground_hwnd(_raw: isize) {}

    pub fn show_interactive_topmost(win: &WebviewWindow, _position: &str) {
        let _ = win.show();
        let _ = win.set_focus();
    }

    pub fn hide_overlay(win: &WebviewWindow) {
        let _ = win.hide();
    }

    pub fn copy_text_to_clipboard(_text: &str) -> Result<(), String> {
        Err("รองรับการคัดลอกผ่าน Windows Clipboard API บน Windows".into())
    }
}

pub fn copy_text_to_clipboard_native(text: &str) -> Result<(), String> {
    if text.is_empty() || text.len() > 4096 {
        return Err("ข้อความคำสั่งไม่ถูกต้องหรือยาวเกินไป".into());
    }
    win_crp::copy_text_to_clipboard(text)
}

fn ensure_crp_overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(CRP_OVERLAY_LABEL) {
        return Ok(existing);
    }

    let win = WebviewWindowBuilder::new(
        app,
        CRP_OVERLAY_LABEL,
        WebviewUrl::App("index.html?window=crp-overlay".into()),
    )
    .title("FiveM C-RP-SRP Overlay")
    .inner_size(CRP_WIDTH, CRP_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(true)
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|e| format!("สร้างหน้าต่าง FiveM C-RP-SRP Overlay ไม่สำเร็จ: {e}"))?;

    crate::security::lock_webview_window(&win);
    Ok(win)
}

fn show_crp_overlay_window_internal(
    app: &AppHandle,
    manager: &CrpOverlayManager,
    position: &str,
) -> Result<(), String> {
    let fg = win_crp::current_foreground_hwnd();
    let own_overlay_hwnd = app
        .get_webview_window(CRP_OVERLAY_LABEL)
        .and_then(|w| w.hwnd().ok().map(|h| h.0 as isize))
        .unwrap_or(0);
    if fg != 0 && fg != own_overlay_hwnd {
        manager.prev_fg_hwnd.store(fg, Ordering::SeqCst);
    }

    let app_ui = app.clone();
    let pos = position.to_string();
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    let _ = app.run_on_main_thread(move || {
        let res = ensure_crp_overlay_window(&app_ui).map(|win| {
            win_crp::show_interactive_topmost(&win, &pos);
        });
        let _ = tx.send(res);
    });
    rx.recv_timeout(Duration::from_millis(1500))
        .map_err(|_| "ไม่สามารถเปิดหน้าต่าง Overlay ได้ทันเวลา".to_string())?
}

fn hide_crp_overlay_window_internal(
    app: &AppHandle,
    manager: &CrpOverlayManager,
    restore_prev_focus: bool,
) {
    let prev = manager.prev_fg_hwnd.swap(0, Ordering::SeqCst);
    let app_ui = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_ui.get_webview_window(CRP_OVERLAY_LABEL) {
            win_crp::hide_overlay(&win);
        }
        if restore_prev_focus && prev != 0 {
            win_crp::restore_foreground_hwnd(prev);
        }
    });
}

fn start_crp_worker(app: AppHandle, manager: CrpOverlayManager, overlay_mgr: OverlayManager) {
    let _ = std::thread::Builder::new()
        .name("estra-crp-overlay".into())
        .spawn(move || {
            crate::security::hide_sensitive_thread();
            let mut was_down = false;
            let mut last_toggle = Instant::now() - Duration::from_secs(5);
            let mut last_hotkey = String::new();
            let mut last_schedule_check = Instant::now() - Duration::from_secs(10);
            let mut last_fivem_check = Instant::now() - Duration::from_secs(10);
            let mut cached_fivem_running = false;
            let mut fired_keys: HashSet<String> = HashSet::new();

            loop {
                if !manager.is_installed() {
                    break;
                }
                let cfg = manager.snapshot_config();
                if !cfg.enabled {
                    was_down = false;
                    let (lock, cvar) = &*manager.wake;
                    if let Ok(guard) = lock.lock() {
                        let _ = cvar.wait_timeout(guard, Duration::from_millis(250));
                    }
                    continue;
                }

                if cfg.only_in_game && last_fivem_check.elapsed() >= Duration::from_millis(2200) {
                    last_fivem_check = Instant::now();
                    cached_fivem_running = get_fivem_sessions()
                        .map(|pids| !pids.is_empty())
                        .unwrap_or(false);
                } else if !cfg.only_in_game {
                    cached_fivem_running = true;
                }

                // 1. Hotkey check
                if let Ok((ctrl, alt, shift, vk, canonical)) = parse_crp_hotkey(&cfg.toggle_hotkey) {
                    if canonical != last_hotkey {
                        was_down = false;
                        last_hotkey = canonical.to_string();
                    }
                    let is_down = win_crp::is_hotkey_pressed(ctrl, alt, shift, vk);
                    if is_down && !was_down && last_toggle.elapsed() >= Duration::from_millis(320) {
                        last_toggle = Instant::now();
                        let allow = !cfg.only_in_game
                            || cached_fivem_running
                            || manager.overlay_visible.load(Ordering::SeqCst);
                        if allow {
                            let _ = manager.toggle_overlay(&app, None);
                        }
                    }
                    was_down = is_down;
                }

                // 2. Schedule alert check (every ~2 seconds using local OS clock)
                if cfg.show_schedule_toasts && !cfg.schedules.is_empty() && last_schedule_check.elapsed() >= Duration::from_secs(2) {
                    last_schedule_check = Instant::now();
                    if !cfg.only_in_game || cached_fivem_running {
                        let now = win_crp::current_local_time();
                        let due = evaluate_due_schedules(&cfg.schedules, now, &mut fired_keys);
                        for payload in due {
                            let _ = push_overlay_notification(&app, &overlay_mgr, payload.clone(), false);
                            let _ = app.emit("estra://crp-schedule-fired", payload);
                        }
                    }
                }

                std::thread::sleep(Duration::from_millis(30));
            }

            manager.worker_running.store(false, Ordering::SeqCst);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_crp_hotkeys_and_rejects_invalid() {
        assert_eq!(parse_crp_hotkey("alt+o").unwrap(), (false, true, false, 0x4F, "Alt+O"));
        assert_eq!(parse_crp_hotkey("ctrl + shift + o").unwrap(), (true, false, true, 0x4F, "Ctrl+Shift+O"));
        assert_eq!(parse_crp_hotkey("Insert").unwrap(), (false, false, false, 0x2D, "Insert"));
        assert_eq!(parse_crp_hotkey("F7").unwrap(), (false, false, false, 0x76, "F7"));
        assert!(parse_crp_hotkey("Alt+Tab").is_err());
    }

    #[test]
    fn installs_updates_and_uninstalls_addon_on_disk() {
        let base = std::env::temp_dir().join(format!(
            "estra_crp_addon_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let dir = resolve_addon_dir_from_base(&base).unwrap();
        let (installed, _, _) = load_addon_from_dir(&dir).unwrap();
        assert!(!installed);

        let (manifest, cfg) = install_addon_in_dir(&dir).unwrap();
        assert_eq!(manifest.id, CRP_ADDON_ID);
        assert_eq!(cfg.commands.len(), 4);

        let (installed_after, loaded_man, loaded_cfg) = load_addon_from_dir(&dir).unwrap();
        assert!(installed_after);
        assert_eq!(loaded_man.unwrap().version, CRP_ADDON_VERSION);
        assert_eq!(loaded_cfg.roll_count, 4);

        uninstall_addon_in_dir(&dir).unwrap();
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn evaluates_weekly_and_pre_reminder_schedules_with_dedup() {
        let schedules = vec![CrpScheduleItem {
            id: "cls-1".into(),
            title: "วิชาดนตรี".into(),
            category: "class".into(),
            schedule_type: "weekly".into(),
            days_of_week: vec![1], // Monday
            date: String::new(),
            time: "00:05".into(),
            remind_before_minutes: 10,
            notify_at_start: true,
            location: "ห้อง 204".into(),
            note: "เตรียมเครื่องดนตรี".into(),
            enabled: true,
        }];
        let mut fired = HashSet::new();

        // Sunday 23:55 (day before Monday 00:05) -> 10 min pre-reminder fires!
        let sun_night = LocalDateTime {
            year: 2026,
            month: 11,
            day: 15, // 2026-11-15 is Sunday
            dow: 0,
            hour: 23,
            minute: 55,
        };
        let alerts = evaluate_due_schedules(&schedules, sun_night, &mut fired);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].kind, "schedule-alert");
        assert!(alerts[0].badge.contains("10 นาที"));

        // Polling again in the same minute does not duplicate
        let alerts_dup = evaluate_due_schedules(&schedules, sun_night, &mut fired);
        assert!(alerts_dup.is_empty());

        // Monday 00:05 -> start notification fires!
        let mon_start = LocalDateTime {
            year: 2026,
            month: 11,
            day: 16,
            dow: 1,
            hour: 0,
            minute: 5,
        };
        let start_alerts = evaluate_due_schedules(&schedules, mon_start, &mut fired);
        assert_eq!(start_alerts.len(), 1);
        assert!(start_alerts[0].badge.contains("ถึงเวลาแล้ว"));
    }
}
