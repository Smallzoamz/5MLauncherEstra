pub mod crp_overlay;
pub mod file_safety;
pub mod fivem;
pub mod maintenance;
pub mod overlay;
pub mod patcher;
pub mod perf_overlay;
pub mod player_name;
pub mod presence;
pub mod screenshots;
pub mod security;
pub mod session;
pub mod social;
pub mod startup;
pub mod voice_note;

use crate::crp_overlay::{
    copy_text_to_clipboard_native, CrpAddonState, CrpOverlayConfig, CrpOverlayManager,
};
use crate::fivem::{
    detect_game_environment, execute_real_clean_cache, install_fivem_bootstrap, query_live_server,
    resolve_installation, CleanCacheResult, FiveMInstallation, GameEnvironmentReport,
    InstallFiveMResult, LaunchRequest, LaunchResult, LiveServerInfo,
};
use crate::maintenance::{
    clean_maintenance, preview_maintenance, CleanMaintenanceRequest, MaintenanceCleanResult,
    MaintenancePreviewResult,
};
use crate::patcher::{
    apply_city_patch, check_city_patch, check_launcher_update, install_launcher_update,
    LauncherUpdateCheck, PatchApplyResult, PatchCancelFlag, PatchCheckResult,
};
use crate::overlay::{
    ensure_overlay_window, hide_overlay_window, push_overlay_notification, OverlayManager,
    OverlayNotificationPayload, OverlaySettings,
};
use crate::perf_overlay::{
    ensure_clock_overlay_window, ensure_perf_overlay_window, ClockOverlaySettings,
    ClockOverlayState, PerfMetricsSnapshot, PerfOverlayManager, PerfOverlaySettings,
};
use crate::presence::{get_system_presence, SystemPresence};
use crate::screenshots::{
    capture_screenshot_now, copy_screenshot_to_clipboard_by_dir, delete_screenshot_by_dir,
    list_screenshots_in_dir, open_screenshots_folder, read_screenshot_data_url_by_dir,
    resolve_screenshots_dir, start_hotkey_listener, CaptureScreenshotResult, ScreenshotConfig,
    ScreenshotListResult, ScreenshotManager,
};
use crate::session::GameSessionMonitor;
use crate::social::{social_request, SocialState};
use crate::startup::{
    apply_process_priority, get_startup_settings, is_autostart_arg, is_windows_startup_enabled,
    set_startup_settings, StartupSettingsState,
};
use crate::voice_note::{
    download_local_whisper_runtime, VoiceAddonState, VoiceNoteConfig, VoiceNoteManager,
};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

pub struct AppState {
    pub monitor: GameSessionMonitor,
    pub mutation_lock: AsyncMutex<()>,
    pub patch_cancel: PatchCancelFlag,
    pub tray_launch_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    pub latest_city_enabled: Mutex<bool>,
    pub social: SocialState,
    pub screenshots: ScreenshotManager,
    pub overlay: OverlayManager,
    pub perf_overlay: PerfOverlayManager,
    pub crp_overlay: CrpOverlayManager,
    pub voice_note: VoiceNoteManager,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            monitor: GameSessionMonitor::default(),
            mutation_lock: AsyncMutex::new(()),
            patch_cancel: PatchCancelFlag::default(),
            tray_launch_item: Mutex::new(None),
            latest_city_enabled: Mutex::new(false),
            social: SocialState::default(),
            screenshots: ScreenshotManager::default(),
            overlay: OverlayManager::default(),
            perf_overlay: PerfOverlayManager::default(),
            crp_overlay: CrpOverlayManager::default(),
            voice_note: VoiceNoteManager::default(),
        }
    }
}

fn restore_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
async fn get_system_presence_cmd() -> SystemPresence {
    get_system_presence().await
}

#[tauri::command]
async fn query_server_cmd(target: String) -> Result<LiveServerInfo, String> {
    query_live_server(&target, true).await
}

#[tauri::command]
async fn resolve_installation_cmd(path: String) -> Result<FiveMInstallation, String> {
    tokio::task::spawn_blocking(move || resolve_installation(&path))
        .await
        .map_err(|_| "ตรวจสอบพาธ FiveM ไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn detect_game_environment_cmd(path: String) -> Result<GameEnvironmentReport, String> {
    tokio::task::spawn_blocking(move || detect_game_environment(&path))
        .await
        .map_err(|_| "ตรวจหา GTA V และ FiveM ไม่สำเร็จ".to_string())
}

#[tauri::command]
async fn install_fivem_bootstrap_cmd(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    target_dir: String,
) -> Result<InstallFiveMResult, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    install_fivem_bootstrap(&target_dir).await
}

#[tauri::command]
async fn launch_fivem_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    request: LaunchRequest,
) -> Result<LaunchResult, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    state.monitor.launch(app, request).await
}

#[tauri::command]
async fn clean_cache_cmd(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    fivem_path: String,
) -> Result<CleanCacheResult, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    tokio::task::spawn_blocking(move || execute_real_clean_cache(&fivem_path))
        .await
        .map_err(|_| "ล้างแคชไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn preview_maintenance_cmd(fivem_path: String) -> Result<MaintenancePreviewResult, String> {
    tokio::task::spawn_blocking(move || preview_maintenance(&fivem_path))
        .await
        .map_err(|_| "ตรวจสอบขนาดไฟล์ไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn clean_maintenance_cmd(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    request: CleanMaintenanceRequest,
) -> Result<MaintenanceCleanResult, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    tokio::task::spawn_blocking(move || clean_maintenance(request))
        .await
        .map_err(|_| "ล้างไฟล์ FiveM ไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn check_launcher_update_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    github_repo: Option<String>,
) -> Result<LauncherUpdateCheck, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    check_launcher_update(&app, github_repo.as_deref()).await
}

#[tauri::command]
async fn install_launcher_update_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    github_repo: Option<String>,
) -> Result<String, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    let _msg = install_launcher_update(&app, github_repo.as_deref()).await?;
    drop(guard);
    app.restart();
}

#[tauri::command]
async fn check_city_patch_cmd(
    webview: tauri::Webview,
    manifest_url: String,
    fivem_path: String,
    server_id: String,
) -> Result<PatchCheckResult, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    check_city_patch(&manifest_url, &fivem_path, &server_id).await
}

#[tauri::command]
async fn apply_city_patch_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    manifest_url: String,
    fivem_path: String,
    server_id: String,
) -> Result<PatchApplyResult, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    apply_city_patch(
        &app,
        &manifest_url,
        &fivem_path,
        &server_id,
        state.patch_cancel.clone(),
    )
    .await
}

#[tauri::command]
fn cancel_city_patch_cmd(state: State<'_, AppState>) {
    state.patch_cancel.0.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn set_latest_city_cmd(
    state: State<'_, AppState>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    if name.chars().count() > 100 || name.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Ok(());
    }
    let active = !name.trim().is_empty() && enabled;
    if let Ok(mut flag) = state.latest_city_enabled.lock() {
        *flag = active;
    }
    if !name.trim().is_empty() {
        state.screenshots.set_city_name(name.trim());
    }
    if let Ok(guard) = state.tray_launch_item.lock() {
        if let Some(item) = guard.as_ref() {
            let label = if name.trim().is_empty() {
                "เข้าเมืองล่าสุด — ยังไม่มีประวัติ".to_string()
            } else {
                format!("เข้าเมืองล่าสุด: {}", name.replace('&', "&&"))
            };
            let _ = item.set_text(label);
            let _ = item.set_enabled(active);
        }
    }
    Ok(())
}

#[tauri::command]
fn window_minimize_cmd(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
fn window_hide_cmd(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn window_toggle_maximize_cmd(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        } else {
            let _ = win.maximize();
        }
    }
}

#[tauri::command]
fn window_close_cmd(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_external_url_cmd(webview: tauri::Webview, url: String) -> Result<(), String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 500 || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("ลิงก์ไม่ถูกต้อง".to_string());
    }
    let parsed = url::Url::parse(trimmed).map_err(|_| "รูปแบบลิงก์ไม่ถูกต้อง".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http") || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("รองรับเฉพาะลิงก์ https:// หรือ http:// เท่านั้น".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| format!("ไม่สามารถเปิดเบราว์เซอร์ได้: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = parsed;
        Err("รองรับการเปิดลิงก์อัตโนมัติบน Windows".to_string())
    }
}

#[tauri::command]
async fn social_request_cmd(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    social_server_url: Option<String>,
) -> Result<serde_json::Value, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    social_request(&state.social, method, path, body, social_server_url).await
}

#[tauri::command]
fn get_startup_settings_cmd() -> StartupSettingsState {
    get_startup_settings()
}

#[tauri::command]
fn set_startup_settings_cmd(
    webview: tauri::Webview,
    enabled: bool,
) -> Result<StartupSettingsState, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    set_startup_settings(enabled)
}

#[tauri::command]
fn set_screenshot_config_cmd(
    state: State<'_, AppState>,
    config: ScreenshotConfig,
) -> Result<ScreenshotConfig, String> {
    state.screenshots.update_config(config)
}

#[tauri::command]
async fn capture_screenshot_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CaptureScreenshotResult, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let manager = state.screenshots.clone();
    let overlay = state.overlay.clone();
    let perf_overlay = state.perf_overlay.clone();
    tokio::task::spawn_blocking(move || {
        capture_screenshot_now(&app, &manager, Some(&overlay), Some(&perf_overlay))
    })
    .await
    .map_err(|_| "จับภาพหน้าจอไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn list_screenshots_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: Option<String>,
) -> Result<ScreenshotListResult, String> {
    let custom_dir = dir.unwrap_or_else(|| state.screenshots.snapshot().dir);
    tokio::task::spawn_blocking(move || {
        let folder = resolve_screenshots_dir(&app, &custom_dir)?;
        list_screenshots_in_dir(&folder)
    })
    .await
    .map_err(|_| "โหลดรายการภาพหน้าจอไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn read_screenshot_data_url_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
    max_width: Option<u32>,
    dir: Option<String>,
) -> Result<String, String> {
    let custom_dir = dir.unwrap_or_else(|| state.screenshots.snapshot().dir);
    tokio::task::spawn_blocking(move || {
        let folder = resolve_screenshots_dir(&app, &custom_dir)?;
        read_screenshot_data_url_by_dir(&folder, &filename, max_width)
    })
    .await
    .map_err(|_| "อ่านไฟล์ภาพหน้าจอไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn copy_screenshot_to_clipboard_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
    dir: Option<String>,
) -> Result<(), String> {
    let custom_dir = dir.unwrap_or_else(|| state.screenshots.snapshot().dir);
    tokio::task::spawn_blocking(move || {
        let folder = resolve_screenshots_dir(&app, &custom_dir)?;
        copy_screenshot_to_clipboard_by_dir(&folder, &filename)
    })
    .await
    .map_err(|_| "คัดลอกภาพหน้าจอไม่สำเร็จ".to_string())?
}

#[tauri::command]
async fn delete_screenshot_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
    dir: Option<String>,
) -> Result<(), String> {
    let custom_dir = dir.unwrap_or_else(|| state.screenshots.snapshot().dir);
    tokio::task::spawn_blocking(move || {
        let folder = resolve_screenshots_dir(&app, &custom_dir)?;
        delete_screenshot_by_dir(&folder, &filename)
    })
    .await
    .map_err(|_| "ลบไฟล์ภาพหน้าจอไม่สำเร็จ".to_string())?
}

#[tauri::command]
fn open_screenshots_folder_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: Option<String>,
) -> Result<String, String> {
    let custom_dir = dir.unwrap_or_else(|| state.screenshots.snapshot().dir);
    open_screenshots_folder(&app, &custom_dir)
}

#[tauri::command]
fn set_overlay_settings_cmd(
    state: State<'_, AppState>,
    settings: OverlaySettings,
) -> Result<OverlaySettings, String> {
    state.overlay.update_settings(settings)
}

#[tauri::command]
fn push_overlay_notification_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: OverlayNotificationPayload,
    force: Option<bool>,
) -> Result<bool, String> {
    push_overlay_notification(&app, &state.overlay, payload, force.unwrap_or(false))
}

#[tauri::command]
fn drain_overlay_pending_cmd(state: State<'_, AppState>) -> Vec<OverlayNotificationPayload> {
    state.overlay.drain_pending()
}

#[tauri::command]
fn hide_overlay_window_cmd(app: AppHandle) {
    hide_overlay_window(&app);
}

#[tauri::command]
fn set_perf_overlay_settings_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    settings: PerfOverlaySettings,
) -> Result<PerfOverlaySettings, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    state.perf_overlay.update_settings(&app, settings)
}

#[tauri::command]
fn get_perf_metrics_snapshot_cmd(
    webview: tauri::Webview,
    state: State<'_, AppState>,
) -> Result<PerfMetricsSnapshot, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    Ok(state.perf_overlay.snapshot_metrics())
}

#[tauri::command]
fn set_clock_overlay_settings_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    settings: ClockOverlaySettings,
) -> Result<ClockOverlaySettings, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    state.perf_overlay.update_clock_settings(&app, settings)
}

#[tauri::command]
fn get_clock_overlay_state_cmd(
    webview: tauri::Webview,
    state: State<'_, AppState>,
) -> Result<ClockOverlayState, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    Ok(state.perf_overlay.snapshot_clock_state())
}

#[tauri::command]
fn get_crp_addon_state_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CrpAddonState, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    if !state.crp_overlay.is_installed() {
        state
            .crp_overlay
            .init_from_disk(&app, state.overlay.clone());
    }
    Ok(state.crp_overlay.snapshot_state(Some(&app)))
}

#[tauri::command]
async fn install_crp_addon_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CrpAddonState, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    state.crp_overlay.install(&app, state.overlay.clone())
}

#[tauri::command]
async fn uninstall_crp_addon_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CrpAddonState, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    state.crp_overlay.uninstall(&app)
}

#[tauri::command]
fn set_crp_overlay_config_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    config: CrpOverlayConfig,
) -> Result<CrpAddonState, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    state
        .crp_overlay
        .update_config(&app, state.overlay.clone(), config)
}

#[tauri::command]
fn toggle_crp_overlay_window_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    visible: Option<bool>,
) -> Result<bool, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    state.crp_overlay.toggle_overlay(&app, visible)
}

#[tauri::command]
fn hide_crp_overlay_window_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    state.crp_overlay.toggle_overlay(&app, Some(false))
}

#[tauri::command]
fn copy_text_to_clipboard_cmd(
    webview: tauri::Webview,
    text: String,
) -> Result<(), String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    copy_text_to_clipboard_native(&text)
}

#[tauri::command]
fn get_voice_note_state_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceAddonState, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    if !state.voice_note.is_installed() {
        state.voice_note.init_from_disk(&app);
    }
    Ok(state.voice_note.snapshot_state(Some(&app)))
}

#[tauri::command]
async fn install_voice_note_addon_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceAddonState, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    state.voice_note.install(&app)
}

#[tauri::command]
async fn uninstall_voice_note_addon_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceAddonState, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    state.voice_note.uninstall(&app)
}

#[tauri::command]
fn set_voice_note_config_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    config: VoiceNoteConfig,
) -> Result<VoiceAddonState, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    state.voice_note.update_config(&app, config)
}

#[tauri::command]
fn start_voice_note_capture_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceAddonState, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    state.voice_note.start_capture(&app)
}

#[tauri::command]
fn stop_voice_note_capture_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceAddonState, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    Ok(state.voice_note.stop_capture(&app))
}

#[tauri::command]
async fn download_local_whisper_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<VoiceAddonState, String> {
    crate::security::verify_ipc_caller(&webview, false)?;
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    download_local_whisper_runtime(&app, &state.voice_note, model_id).await
}

#[tauri::command]
fn toggle_voice_note_overlay_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    visible: Option<bool>,
) -> Result<bool, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    state.voice_note.toggle_overlay(&app, visible)
}

#[tauri::command]
fn hide_voice_note_overlay_cmd(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    crate::security::verify_ipc_caller(&webview, true)?;
    state.voice_note.toggle_overlay(&app, Some(false))
}

pub fn run() {
    let startup_args: Vec<String> = std::env::args().collect();
    let launched_autostart = is_autostart_arg(&startup_args);
    if launched_autostart || is_windows_startup_enabled() {
        let _ = apply_process_priority(true);
    }

    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !is_autostart_arg(&args) {
                restore_main_window(app);
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let open_item = MenuItemBuilder::with_id("open", "เปิด Estra FiveM Launcher").build(app)?;
            let launch_latest_item =
                MenuItemBuilder::with_id("launch-latest", "เข้าเมืองล่าสุด — ยังไม่มีประวัติ")
                    .enabled(false)
                    .build(app)?;
            let hide_item = MenuItemBuilder::with_id("hide", "ซ่อนลง System Tray").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "ออกจากโปรแกรม").build(app)?;

            let state = app.state::<AppState>();
            if let Ok(mut guard) = state.tray_launch_item.lock() {
                *guard = Some(launch_latest_item.clone());
            }

            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&launch_latest_item)
                .item(&hide_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::with_id("estra-tray")
                .menu(&menu)
                .tooltip("Estra FiveM Launcher")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => restore_main_window(app),
                    "launch-latest" => {
                        let enabled = app
                            .state::<AppState>()
                            .latest_city_enabled
                            .lock()
                            .map(|g| *g)
                            .unwrap_or(false);
                        if enabled {
                            restore_main_window(app);
                            let _ = app.emit("estra://launch-latest", ());
                        }
                    }
                    "hide" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        restore_main_window(tray.app_handle());
                    }
                });

            if let Some(ic) = icon {
                tray_builder = tray_builder.icon(ic);
            }
            tray_builder.build(app)?;

            #[cfg(not(debug_assertions))]
            {
                let prod_name = app.config().product_name.as_deref().unwrap_or("");
                let ident = app.config().identifier.as_str();
                if !security::verify_brand_integrity(prod_name, ident)
                    || !security::verify_embedded_dist_assets(&app.handle())
                {
                    security::mark_tampered();
                    std::process::exit(0);
                }
            }
            security::start_integrity_watchdog();

            if let Some(win) = app.get_webview_window("main") {
                security::lock_webview_window(&win);
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }
            if !launched_autostart {
                restore_main_window(&app.handle());
            }
            let _ = ensure_overlay_window(&app.handle());
            if let Some(overlay_win) = app.get_webview_window("overlay") {
                security::lock_webview_window(&overlay_win);
            }
            let _ = ensure_perf_overlay_window(&app.handle());
            let _ = ensure_clock_overlay_window(&app.handle());
            let app_state = app.state::<AppState>();
            app_state
                .crp_overlay
                .init_from_disk(&app.handle(), app_state.overlay.clone());
            app_state.voice_note.init_from_disk(&app.handle());
            start_hotkey_listener(
                app.handle().clone(),
                app_state.screenshots.clone(),
                app_state.overlay.clone(),
                app_state.perf_overlay.clone(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_presence_cmd,
            query_server_cmd,
            resolve_installation_cmd,
            detect_game_environment_cmd,
            install_fivem_bootstrap_cmd,
            launch_fivem_cmd,
            clean_cache_cmd,
            preview_maintenance_cmd,
            clean_maintenance_cmd,
            check_launcher_update_cmd,
            install_launcher_update_cmd,
            check_city_patch_cmd,
            apply_city_patch_cmd,
            cancel_city_patch_cmd,
            set_latest_city_cmd,
            window_minimize_cmd,
            window_hide_cmd,
            window_toggle_maximize_cmd,
            window_close_cmd,
            open_external_url_cmd,
            social_request_cmd,
            get_startup_settings_cmd,
            set_startup_settings_cmd,
            set_screenshot_config_cmd,
            capture_screenshot_cmd,
            list_screenshots_cmd,
            read_screenshot_data_url_cmd,
            copy_screenshot_to_clipboard_cmd,
            delete_screenshot_cmd,
            open_screenshots_folder_cmd,
            set_overlay_settings_cmd,
            push_overlay_notification_cmd,
            drain_overlay_pending_cmd,
            hide_overlay_window_cmd,
            set_perf_overlay_settings_cmd,
            get_perf_metrics_snapshot_cmd,
            set_clock_overlay_settings_cmd,
            get_clock_overlay_state_cmd,
            get_crp_addon_state_cmd,
            install_crp_addon_cmd,
            uninstall_crp_addon_cmd,
            set_crp_overlay_config_cmd,
            toggle_crp_overlay_window_cmd,
            hide_crp_overlay_window_cmd,
            copy_text_to_clipboard_cmd,
            get_voice_note_state_cmd,
            install_voice_note_addon_cmd,
            uninstall_voice_note_addon_cmd,
            set_voice_note_config_cmd,
            start_voice_note_capture_cmd,
            stop_voice_note_capture_cmd,
            download_local_whisper_cmd,
            toggle_voice_note_overlay_cmd,
            hide_voice_note_overlay_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Estra FiveM Launcher");
}
