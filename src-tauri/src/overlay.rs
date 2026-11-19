use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const OVERLAY_LABEL: &str = "overlay";
const OVERLAY_WIDTH: f64 = 368.0;
const OVERLAY_HEIGHT: f64 = 340.0;
const OVERLAY_MARGIN: i32 = 18;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub notify_screenshot: bool,
    #[serde(default = "default_true")]
    pub notify_friend_online: bool,
    #[serde(default = "default_true")]
    pub notify_friend_in_game: bool,
    #[serde(default = "default_true")]
    pub notify_server_watcher: bool,
}

fn default_true() -> bool {
    true
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            notify_screenshot: true,
            notify_friend_online: true,
            notify_friend_in_game: true,
            notify_server_watcher: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayNotificationPayload {
    pub id: String,
    pub kind: String, // "screenshot" | "friend-online" | "friend-in-game" | "schedule-alert"
    pub badge: String,
    pub title: String,
    pub subtitle: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub image_url: String,
    #[serde(default)]
    pub initials: String,
    #[serde(default)]
    pub accent_color: String,
    #[serde(default = "default_duration_ms")]
    pub duration_ms: u64,
}

fn default_duration_ms() -> u64 {
    4500
}

#[derive(Clone, Default)]
pub struct OverlayManager {
    settings: Arc<Mutex<OverlaySettings>>,
    pending: Arc<Mutex<Vec<OverlayNotificationPayload>>>,
}

impl OverlayManager {
    pub fn update_settings(&self, next: OverlaySettings) -> Result<OverlaySettings, String> {
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| "ไม่สามารถอัปเดตการตั้งค่า Overlay ได้".to_string())?;
        *guard = next.clone();
        Ok(next)
    }

    pub fn snapshot(&self) -> OverlaySettings {
        self.settings.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn should_notify(&self, kind: &str) -> bool {
        let cfg = self.snapshot();
        if !cfg.enabled {
            return false;
        }
        match kind {
            "screenshot" => cfg.notify_screenshot,
            "friend-online" => cfg.notify_friend_online,
            "friend-in-game" => cfg.notify_friend_in_game,
            "server-watcher" => cfg.notify_server_watcher,
            "schedule-alert" => true,
            _ => true,
        }
    }

    pub fn enqueue_pending(&self, item: OverlayNotificationPayload) {
        if let Ok(mut guard) = self.pending.lock() {
            guard.push(item);
            if guard.len() > 5 {
                let drop_count = guard.len() - 5;
                guard.drain(0..drop_count);
            }
        }
    }

    pub fn drain_pending(&self) -> Vec<OverlayNotificationPayload> {
        if let Ok(mut guard) = self.pending.lock() {
            std::mem::take(&mut *guard)
        } else {
            Vec::new()
        }
    }

    pub fn remove_pending(&self, id: &str) {
        if let Ok(mut guard) = self.pending.lock() {
            guard.retain(|item| item.id != id);
        }
    }
}

pub fn sanitize_overlay_payload(mut payload: OverlayNotificationPayload) -> OverlayNotificationPayload {
    payload.id = payload.id.trim().chars().take(80).collect();
    if payload.id.is_empty() {
        payload.id = uuid::Uuid::new_v4().to_string();
    }
    payload.kind = match payload.kind.as_str() {
        "screenshot" | "friend-online" | "friend-in-game" | "schedule-alert" | "server-watcher" => {
            payload.kind
        }
        _ => "friend-online".to_string(),
    };
    payload.badge = payload.badge.trim().chars().take(48).collect();
    payload.title = payload.title.trim().chars().take(120).collect();
    payload.subtitle = payload.subtitle.trim().chars().take(160).collect();
    payload.detail = payload.detail.trim().chars().take(160).collect();
    payload.initials = payload.initials.trim().chars().take(4).collect();

    let clean_img = payload.image_url.trim().to_string();
    let img_allowed = clean_img.is_empty()
        || clean_img.starts_with("data:image/png;base64,")
        || clean_img.starts_with("https://");
    payload.image_url = if img_allowed && clean_img.len() <= 512_000 {
        clean_img
    } else {
        String::new()
    };

    if !payload.accent_color.starts_with('#')
        || payload.accent_color.len() > 9
        || !payload.accent_color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        payload.accent_color = String::new();
    }

    payload.duration_ms = payload.duration_ms.clamp(2000, 10000);
    payload
}

#[cfg(target_os = "windows")]
mod win_overlay {
    use super::{OVERLAY_HEIGHT, OVERLAY_MARGIN, OVERLAY_WIDTH};
    use tauri::WebviewWindow;

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TRANSPARENT: isize = 0x0000_0020;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;
    const HWND_TOPMOST: isize = -1;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const SWP_NOSENDCHANGING: u32 = 0x0400;
    const MONITOR_DEFAULTTOPRIMARY: u32 = 1;
    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;

    #[repr(C)]
    #[derive(Default)]
    struct RECT {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MONITORINFO {
        cb_size: u32,
        rc_monitor: RECT,
        rc_work: RECT,
        dw_flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> isize;
        fn MonitorFromWindow(hwnd: isize, dwFlags: u32) -> isize;
        fn GetMonitorInfoW(hMonitor: isize, lpmi: *mut MONITORINFO) -> i32;
        fn GetSystemMetrics(nIndex: i32) -> i32;
        fn GetWindowLongPtrW(hWnd: isize, nIndex: i32) -> isize;
        fn SetWindowLongPtrW(hWnd: isize, nIndex: i32, dwNewLong: isize) -> isize;
        fn SetWindowPos(
            hWnd: isize,
            hWndInsertAfter: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            uFlags: u32,
        ) -> i32;
    }

    fn active_work_area() -> (i32, i32, i32, i32) {
        let fg = unsafe { GetForegroundWindow() };
        let hmon = unsafe { MonitorFromWindow(fg, MONITOR_DEFAULTTOPRIMARY) };
        if hmon != 0 {
            let mut info = MONITORINFO {
                cb_size: std::mem::size_of::<MONITORINFO>() as u32,
                rc_monitor: RECT::default(),
                rc_work: RECT::default(),
                dw_flags: 0,
            };
            if unsafe { GetMonitorInfoW(hmon, &mut info) } != 0 {
                let area = if info.rc_work.right > info.rc_work.left
                    && info.rc_work.bottom > info.rc_work.top
                {
                    info.rc_work
                } else {
                    info.rc_monitor
                };
                return (area.left, area.top, area.right, area.bottom);
            }
        }
        let w = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(800);
        let h = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(600);
        (0, 0, w, h)
    }

    pub fn show_topmost_no_activate(win: &WebviewWindow) {
        let _ = win.set_ignore_cursor_events(true);
        let Ok(hwnd) = win.hwnd() else {
            let _ = win.show();
            return;
        };
        let raw_hwnd = hwnd.0 as isize;
        let scale = win.scale_factor().unwrap_or(1.0);
        let phys_w = (OVERLAY_WIDTH * scale).round() as i32;
        let phys_h = (OVERLAY_HEIGHT * scale).round() as i32;
        let margin = (OVERLAY_MARGIN as f64 * scale).round() as i32;

        let (_left, _top, right, bottom) = active_work_area();
        let x = right - phys_w - margin;
        let y = bottom - phys_h - margin;

        unsafe {
            let ex_style = GetWindowLongPtrW(raw_hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                raw_hwnd,
                GWL_EXSTYLE,
                ex_style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT,
            );
            SetWindowPos(
                raw_hwnd,
                HWND_TOPMOST,
                x,
                y,
                phys_w,
                phys_h,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_overlay {
    use tauri::WebviewWindow;

    pub fn show_topmost_no_activate(win: &WebviewWindow) {
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.show();
    }
}

pub fn ensure_overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(existing);
    }

    let win = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .title("Estra Overlay Notification")
    .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|e| format!("สร้างหน้าต่าง Overlay ไม่สำเร็จ: {e}"))?;

    let _ = win.set_ignore_cursor_events(true);
    Ok(win)
}

pub fn hide_overlay_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = win.hide();
    }
}

pub fn push_overlay_notification(
    app: &AppHandle,
    manager: &OverlayManager,
    payload: OverlayNotificationPayload,
    force: bool,
) -> Result<bool, String> {
    let clean = sanitize_overlay_payload(payload);
    if !force && !manager.should_notify(&clean.kind) {
        return Ok(false);
    }

    let existed = app.get_webview_window(OVERLAY_LABEL).is_some();
    if !existed {
        manager.enqueue_pending(clean.clone());
    }
    let win = ensure_overlay_window(app)?;
    win_overlay::show_topmost_no_activate(&win);
    if existed {
        let _ = app.emit_to(OVERLAY_LABEL, "estra://overlay-notify", clean);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_overlay_payload_fields_and_image_urls() {
        let sanitized = sanitize_overlay_payload(OverlayNotificationPayload {
            id: "".into(),
            kind: "unknown-kind".into(),
            badge: "เพื่อนออนไลน์".into(),
            title: "Alice".into(),
            subtitle: "ออนไลน์บน Estra แล้ว".into(),
            detail: "".into(),
            image_url: "javascript:alert(1)".into(),
            initials: "ALICE".into(),
            accent_color: "red;".into(),
            duration_ms: 500,
        });

        assert!(!sanitized.id.is_empty());
        assert_eq!(sanitized.kind, "friend-online");
        assert_eq!(sanitized.image_url, "");
        assert_eq!(sanitized.initials, "ALIC");
        assert_eq!(sanitized.accent_color, "");
        assert_eq!(sanitized.duration_ms, 2000);
    }

    #[test]
    fn respects_overlay_category_toggles() {
        let mgr = OverlayManager::default();
        assert!(mgr.should_notify("screenshot"));
        assert!(mgr.should_notify("friend-online"));
        assert!(mgr.should_notify("friend-in-game"));

        mgr.update_settings(OverlaySettings {
            enabled: true,
            notify_screenshot: false,
            notify_friend_online: true,
            notify_friend_in_game: false,
            notify_server_watcher: true,
        })
        .unwrap();

        assert!(!mgr.should_notify("screenshot"));
        assert!(mgr.should_notify("friend-online"));
        assert!(!mgr.should_notify("friend-in-game"));
        assert!(mgr.should_notify("server-watcher"));
        assert!(mgr.should_notify("schedule-alert"));
    }

    #[test]
    fn preserves_schedule_alert_kind_on_sanitize() {
        let sanitized = sanitize_overlay_payload(OverlayNotificationPayload {
            id: "sch-1".into(),
            kind: "schedule-alert".into(),
            badge: "ตารางเรียน".into(),
            title: "วิชาดนตรี".into(),
            subtitle: "ห้อง 204".into(),
            detail: "20:00".into(),
            image_url: "".into(),
            initials: "CLS".into(),
            accent_color: "#38bdf8".into(),
            duration_ms: 6500,
        });
        assert_eq!(sanitized.kind, "schedule-alert");
    }
}
