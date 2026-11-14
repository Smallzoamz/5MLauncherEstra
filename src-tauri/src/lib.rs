pub mod file_safety;
pub mod fivem;
pub mod maintenance;
pub mod patcher;
pub mod player_name;
pub mod presence;
pub mod session;
pub mod social;

use crate::fivem::{
    execute_real_clean_cache, query_live_server, resolve_installation, CleanCacheResult,
    FiveMInstallation, LaunchRequest, LaunchResult, LiveServerInfo,
};
use crate::maintenance::{
    clean_maintenance, preview_maintenance, CleanMaintenanceRequest, MaintenanceCleanResult,
    MaintenancePreviewResult,
};
use crate::patcher::{
    apply_city_patch, check_city_patch, check_launcher_update, install_launcher_update,
    LauncherUpdateCheck, PatchApplyResult, PatchCancelFlag, PatchCheckResult,
};
use crate::presence::{get_system_presence, SystemPresence};
use crate::session::GameSessionMonitor;
use crate::social::{social_request, SocialState};
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
async fn launch_fivem_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LaunchRequest,
) -> Result<LaunchResult, String> {
    let _guard = state
        .mutation_lock
        .try_lock()
        .map_err(|_| "มีคำสั่งกำลังทำงาน กรุณารอสักครู่".to_string())?;
    state.monitor.launch(app, request).await
}

#[tauri::command]
async fn clean_cache_cmd(
    state: State<'_, AppState>,
    fivem_path: String,
) -> Result<CleanCacheResult, String> {
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
    state: State<'_, AppState>,
    request: CleanMaintenanceRequest,
) -> Result<MaintenanceCleanResult, String> {
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
    app: AppHandle,
    github_repo: Option<String>,
) -> Result<LauncherUpdateCheck, String> {
    check_launcher_update(&app, github_repo.as_deref()).await
}

#[tauri::command]
async fn install_launcher_update_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    github_repo: Option<String>,
) -> Result<String, String> {
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
    manifest_url: String,
    fivem_path: String,
    server_id: String,
) -> Result<PatchCheckResult, String> {
    check_city_patch(&manifest_url, &fivem_path, &server_id).await
}

#[tauri::command]
async fn apply_city_patch_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    manifest_url: String,
    fivem_path: String,
    server_id: String,
) -> Result<PatchApplyResult, String> {
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
async fn social_request_cmd(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    social_server_url: Option<String>,
) -> Result<serde_json::Value, String> {
    social_request(&state.social, method, path, body, social_server_url).await
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_main_window(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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

            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_presence_cmd,
            query_server_cmd,
            resolve_installation_cmd,
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
            social_request_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Estra FiveM Launcher");
}
