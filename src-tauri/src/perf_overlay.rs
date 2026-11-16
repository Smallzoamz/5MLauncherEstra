use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const PERF_OVERLAY_LABEL: &str = "perf-overlay";
const PERF_WIDTH: f64 = 304.0;
const PERF_HEIGHT: f64 = 48.0;
const PERF_MARGIN: i32 = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PerfOverlaySettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub only_in_game: bool,
    #[serde(default)]
    pub include_in_screenshots: bool,
    #[serde(default = "default_position")]
    pub position: String,
}

fn default_position() -> String {
    "top-left".to_string()
}

impl Default for PerfOverlaySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            only_in_game: false,
            include_in_screenshots: false,
            position: default_position(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerfMetricsSnapshot {
    pub fps: Option<u32>,
    pub cpu_percent: u8,
    pub gpu_percent: Option<u8>,
    pub fivem_running: bool,
    pub position: String,
    pub timestamp_ms: u64,
}

pub fn normalize_perf_position(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "top-right" | "topright" => "top-right".to_string(),
        "bottom-left" | "bottomleft" => "bottom-left".to_string(),
        "bottom-right" | "bottomright" => "bottom-right".to_string(),
        _ => "top-left".to_string(),
    }
}

pub fn sanitize_perf_settings(mut next: PerfOverlaySettings) -> PerfOverlaySettings {
    next.position = normalize_perf_position(&next.position);
    next
}

pub fn compute_cpu_percent(
    prev_idle: u64,
    prev_kernel: u64,
    prev_user: u64,
    next_idle: u64,
    next_kernel: u64,
    next_user: u64,
) -> Option<u8> {
    let idle_delta = next_idle.saturating_sub(prev_idle);
    let kernel_delta = next_kernel.saturating_sub(prev_kernel);
    let user_delta = next_user.saturating_sub(prev_user);
    let total = kernel_delta.saturating_add(user_delta);
    if total == 0 {
        return None;
    }
    let busy = total.saturating_sub(idle_delta);
    let pct = ((busy as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0);
    Some(pct as u8)
}

pub fn aggregate_gpu_engine_utilization(entries: &[(&str, f64)]) -> u8 {
    use std::collections::HashMap;
    let mut per_engine: HashMap<&str, f64> = HashMap::new();
    for (name, val) in entries {
        if !val.is_finite() || *val < 0.0 {
            continue;
        }
        let clamped = val.clamp(0.0, 100.0);
        let engine_key = name
            .split_once("_luid_")
            .map(|(_, suffix)| suffix)
            .or_else(|| name.rsplit_once("_engtype_").map(|(_, suffix)| suffix))
            .unwrap_or(*name);
        let sum = per_engine.entry(engine_key).or_insert(0.0);
        *sum = (*sum + clamped).clamp(0.0, 100.0);
    }
    let peak = per_engine.into_values().fold(0.0_f64, f64::max);
    peak.round().clamp(0.0, 100.0) as u8
}

pub fn compute_perf_window_origin(
    work_area: (i32, i32, i32, i32),
    win_w: i32,
    win_h: i32,
    margin: i32,
    position: &str,
) -> (i32, i32) {
    let (left, top, right, bottom) = work_area;
    match normalize_perf_position(position).as_str() {
        "top-right" => (right - win_w - margin, top + margin),
        "bottom-left" => (left + margin, bottom - win_h - margin),
        "bottom-right" => (right - win_w - margin, bottom - win_h - margin),
        _ => (left + margin, top + margin),
    }
}

#[derive(Clone, Default)]
pub struct PerfOverlayManager {
    settings: Arc<Mutex<PerfOverlaySettings>>,
    latest: Arc<Mutex<PerfMetricsSnapshot>>,
    generation: Arc<AtomicU64>,
    currently_visible: Arc<AtomicBool>,
}

impl PerfOverlayManager {
    pub fn update_settings(&self, app: &AppHandle, next: PerfOverlaySettings) -> Result<PerfOverlaySettings, String> {
        let clean = sanitize_perf_settings(next);
        {
            let mut guard = self
                .settings
                .lock()
                .map_err(|_| "ไม่สามารถอัปเดตการตั้งค่า Performance Overlay ได้".to_string())?;
            *guard = clean.clone();
        }

        if let Ok(mut snap) = self.latest.lock() {
            snap.position = clean.position.clone();
        }

        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if clean.enabled {
            start_perf_worker(app.clone(), self.clone(), gen);
        } else {
            self.currently_visible.store(false, Ordering::SeqCst);
            hide_perf_overlay_window(app);
        }

        Ok(clean)
    }

    pub fn snapshot_settings(&self) -> PerfOverlaySettings {
        self.settings
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn snapshot_metrics(&self) -> PerfMetricsSnapshot {
        self.latest
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| PerfMetricsSnapshot {
                position: self.snapshot_settings().position,
                ..PerfMetricsSnapshot::default()
            })
    }

    fn set_metrics(&self, metrics: PerfMetricsSnapshot) {
        if let Ok(mut guard) = self.latest.lock() {
            *guard = metrics;
        }
    }

    fn is_current_generation(&self, gen: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == gen && self.snapshot_settings().enabled
    }

    pub fn should_show_window(&self) -> bool {
        let cfg = self.snapshot_settings();
        if !cfg.enabled {
            return false;
        }
        if !cfg.only_in_game {
            return true;
        }
        self.snapshot_metrics().fivem_running
    }
}

pub struct PerfOverlayCaptureGuard {
    app: Option<AppHandle>,
    manager: Option<PerfOverlayManager>,
    was_hidden: bool,
}

impl PerfOverlayCaptureGuard {
    pub fn prepare(app: &AppHandle, manager: &PerfOverlayManager, include_in_screenshots: bool) -> Self {
        if include_in_screenshots {
            return Self {
                app: None,
                manager: None,
                was_hidden: false,
            };
        }

        let Some(win) = app.get_webview_window(PERF_OVERLAY_LABEL) else {
            return Self {
                app: None,
                manager: None,
                was_hidden: false,
            };
        };

        let visible = win.is_visible().unwrap_or(false)
            || manager.currently_visible.load(Ordering::SeqCst);
        if !visible {
            return Self {
                app: None,
                manager: None,
                was_hidden: false,
            };
        }

        let (tx, rx) = std::sync::mpsc::sync_channel::<()>(1);
        let app_clone = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(w) = app_clone.get_webview_window(PERF_OVERLAY_LABEL) {
                let _ = w.hide();
            }
            let _ = tx.send(());
        });
        let _ = rx.recv_timeout(Duration::from_millis(350));
        win_perf::flush_compositor();
        std::thread::sleep(Duration::from_millis(25));

        Self {
            app: Some(app.clone()),
            manager: Some(manager.clone()),
            was_hidden: true,
        }
    }
}

impl Drop for PerfOverlayCaptureGuard {
    fn drop(&mut self) {
        if !self.was_hidden {
            return;
        }
        let (Some(app), Some(manager)) = (self.app.take(), self.manager.take()) else {
            return;
        };
        if !manager.should_show_window() {
            return;
        }
        let position = manager.snapshot_settings().position;
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(win) = app.get_webview_window(PERF_OVERLAY_LABEL) {
                win_perf::show_perf_topmost_no_activate(&win, &position);
            }
        });
    }
}

#[cfg(target_os = "windows")]
mod win_perf {
    use super::{
        aggregate_gpu_engine_utilization, compute_cpu_percent, compute_perf_window_origin,
        PERF_HEIGHT, PERF_MARGIN, PERF_WIDTH,
    };
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::WebviewWindow;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::{FILETIME, HWND};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
    };
    use windows::Win32::Graphics::Dwm::DwmFlush;
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication,
        DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
    };
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
    };
    use windows::Win32::System::Threading::GetSystemTimes;
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetSystemMetrics, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, HWND_TOPMOST, SM_CXSCREEN, SM_CYSCREEN, SWP_NOACTIVATE, SWP_NOSENDCHANGING,
        SWP_SHOWWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    const PDH_MORE_DATA_ERR: u32 = 0x8000_07D2;

    fn filetime_to_u64(ft: FILETIME) -> u64 {
        ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
    }

    pub fn flush_compositor() {
        unsafe {
            let _ = DwmFlush();
        }
    }

    pub fn active_work_area() -> (i32, i32, i32, i32) {
        let fg = unsafe { GetForegroundWindow() };
        let hmon = unsafe { MonitorFromWindow(fg, MONITOR_DEFAULTTOPRIMARY) };
        if !hmon.0.is_null() {
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
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

    pub fn show_perf_topmost_no_activate(win: &WebviewWindow, position: &str) {
        let _ = win.set_ignore_cursor_events(true);
        let Ok(hwnd) = win.hwnd() else {
            let _ = win.show();
            return;
        };
        let target_hwnd = HWND(hwnd.0);
        let scale = win.scale_factor().unwrap_or(1.0);
        let phys_w = (PERF_WIDTH * scale).round() as i32;
        let phys_h = (PERF_HEIGHT * scale).round() as i32;
        let margin = (PERF_MARGIN as f64 * scale).round() as i32;

        let work_area = active_work_area();
        let (x, y) = compute_perf_window_origin(work_area, phys_w, phys_h, margin, position);

        unsafe {
            let ex_style = GetWindowLongPtrW(target_hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                target_hwnd,
                GWL_EXSTYLE,
                ex_style
                    | (WS_EX_NOACTIVATE.0 as isize)
                    | (WS_EX_TOOLWINDOW.0 as isize)
                    | (WS_EX_TRANSPARENT.0 as isize),
            );
            let _ = SetWindowPos(
                target_hwnd,
                Some(HWND_TOPMOST),
                x,
                y,
                phys_w,
                phys_h,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING,
            );
        }
    }

    pub struct CpuSampler {
        prev: Option<(u64, u64, u64)>,
    }

    impl CpuSampler {
        pub fn new() -> Self {
            let mut sampler = Self { prev: None };
            let _ = sampler.sample();
            sampler
        }

        pub fn sample(&mut self) -> u8 {
            let (mut idle, mut kernel, mut user) =
                (FILETIME::default(), FILETIME::default(), FILETIME::default());
            if unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }
                .is_err()
            {
                return 0;
            }
            let next = (
                filetime_to_u64(idle),
                filetime_to_u64(kernel),
                filetime_to_u64(user),
            );
            let pct = match self.prev {
                Some(prev) => {
                    compute_cpu_percent(prev.0, prev.1, prev.2, next.0, next.1, next.2).unwrap_or(0)
                }
                None => 0,
            };
            self.prev = Some(next);
            pct
        }
    }

    pub struct GpuSampler {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
        primed: bool,
    }

    impl GpuSampler {
        pub fn new() -> Self {
            let mut s = Self {
                query: PDH_HQUERY::default(),
                counter: PDH_HCOUNTER::default(),
                primed: false,
            };
            s.reopen();
            s
        }

        fn close(&mut self) {
            if !self.query.is_invalid() && !self.query.0.is_null() {
                unsafe {
                    let _ = PdhCloseQuery(self.query);
                }
            }
            self.query = PDH_HQUERY::default();
            self.counter = PDH_HCOUNTER::default();
            self.primed = false;
        }

        fn reopen(&mut self) {
            self.close();
            let mut query = PDH_HQUERY::default();
            if unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut query) } != 0 {
                return;
            }
            let path: Vec<u16> = "\\GPU Engine(*)\\Utilization Percentage\0"
                .encode_utf16()
                .collect();
            let mut counter = PDH_HCOUNTER::default();
            let status = unsafe {
                PdhAddEnglishCounterW(query, PCWSTR(path.as_ptr()), 0, &mut counter)
            };
            if status != 0 {
                unsafe {
                    let _ = PdhCloseQuery(query);
                }
                return;
            }
            let collected = unsafe { PdhCollectQueryData(query) } == 0;
            self.query = query;
            self.counter = counter;
            self.primed = collected;
        }

        pub fn sample(&mut self) -> Option<u8> {
            if self.query.is_invalid() || self.query.0.is_null() {
                self.reopen();
                return None;
            }
            if unsafe { PdhCollectQueryData(self.query) } != 0 {
                self.reopen();
                return None;
            }
            if !self.primed {
                self.primed = true;
                return Some(0);
            }

            let mut buf_size: u32 = 0;
            let mut item_count: u32 = 0;
            let status = unsafe {
                PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut buf_size,
                    &mut item_count,
                    None,
                )
            };
            if status != PDH_MORE_DATA_ERR || buf_size == 0 {
                if status != 0 {
                    self.reopen();
                }
                return Some(0);
            }

            let item_stride = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
            let cap = (buf_size as usize + item_stride - 1) / item_stride;
            let mut items: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> = vec![Default::default(); cap.max(1)];
            let status = unsafe {
                PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut buf_size,
                    &mut item_count,
                    Some(items.as_mut_ptr()),
                )
            };
            if status != 0 {
                self.reopen();
                return None;
            }

            let count = (item_count as usize).min(items.len());
            let mut owned_entries: Vec<(String, f64)> = Vec::with_capacity(count);
            for item in &items[..count] {
                if item.szName.0.is_null() || !matches!(item.FmtValue.CStatus, 0 | 1) {
                    continue;
                }
                let name = unsafe { wide_ptr_to_string(item.szName.0) };
                let val = unsafe { item.FmtValue.Anonymous.doubleValue };
                if val.is_finite() && val >= 0.0 {
                    owned_entries.push((name, val));
                }
            }
            let borrowed: Vec<(&str, f64)> = owned_entries
                .iter()
                .map(|(n, v)| (n.as_str(), *v))
                .collect();
            Some(aggregate_gpu_engine_utilization(&borrowed))
        }
    }

    impl Drop for GpuSampler {
        fn drop(&mut self) {
            self.close();
        }
    }

    unsafe fn wide_ptr_to_string(ptr: *const u16) -> String {
        let mut len = 0usize;
        while *ptr.add(len) != 0 && len < 512 {
            len += 1;
        }
        OsString::from_wide(std::slice::from_raw_parts(ptr, len))
            .to_string_lossy()
            .into_owned()
    }

    fn create_duplication_for_monitor(
        target_hmon: HMONITOR,
    ) -> Option<(IDXGIOutputDuplication, HMONITOR)> {
        let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.ok()?;
        let mut fallback_match = None;

        let mut adapter_idx = 0u32;
        while let Ok(adapter) = unsafe { factory.EnumAdapters1(adapter_idx) } {
            adapter_idx += 1;
            let mut output_idx = 0u32;
            while let Ok(output) = unsafe { adapter.EnumOutputs(output_idx) } {
                output_idx += 1;
                let Ok(desc) = (unsafe { output.GetDesc() }) else {
                    continue;
                };
                if desc.AttachedToDesktop == false {
                    continue;
                }
                let is_target = !target_hmon.0.is_null() && desc.Monitor == target_hmon;
                if !is_target && fallback_match.is_some() {
                    continue;
                }

                let Ok(adapter_base): Result<IDXGIAdapter, _> = adapter.cast() else {
                    continue;
                };
                let mut device: Option<ID3D11Device> = None;
                let hr = unsafe {
                    D3D11CreateDevice(
                        Some(&adapter_base),
                        D3D_DRIVER_TYPE_UNKNOWN,
                        Default::default(),
                        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                        None,
                        D3D11_SDK_VERSION,
                        Some(&mut device),
                        None,
                        None,
                    )
                };
                if hr.is_err() {
                    continue;
                }
                let Some(device) = device else {
                    continue;
                };
                let Ok(output1): Result<IDXGIOutput1, _> = output.cast() else {
                    continue;
                };
                if let Ok(dupl) = unsafe { output1.DuplicateOutput(&device) } {
                    if is_target {
                        return Some((dupl, desc.Monitor));
                    }
                    if fallback_match.is_none() {
                        fallback_match = Some((dupl, desc.Monitor));
                    }
                }
            }
        }
        fallback_match
    }

    pub struct FpsCollectorHandle {
        frames: Arc<AtomicU32>,
        available: Arc<AtomicBool>,
        stop: Arc<AtomicBool>,
    }

    impl FpsCollectorHandle {
        pub fn start() -> Self {
            let frames = Arc::new(AtomicU32::new(0));
            let available = Arc::new(AtomicBool::new(false));
            let stop = Arc::new(AtomicBool::new(false));

            let frames_c = Arc::clone(&frames);
            let avail_c = Arc::clone(&available);
            let stop_c = Arc::clone(&stop);

            let _ = std::thread::Builder::new()
                .name("estra-fps-dxgi".into())
                .spawn(move || {
                    crate::security::hide_sensitive_thread();
                    unsafe {
                        let _ =
                            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                    }
                    while !stop_c.load(Ordering::Relaxed) {
                        let fg_mon = unsafe {
                            MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTOPRIMARY)
                        };
                        let Some((dupl, attached_mon)) = create_duplication_for_monitor(fg_mon)
                        else {
                            avail_c.store(false, Ordering::Relaxed);
                            std::thread::sleep(Duration::from_millis(750));
                            continue;
                        };
                        avail_c.store(true, Ordering::Relaxed);
                        let mut last_mon_check = std::time::Instant::now();

                        while !stop_c.load(Ordering::Relaxed) {
                            if last_mon_check.elapsed() >= Duration::from_millis(1200) {
                                last_mon_check = std::time::Instant::now();
                                let cur_mon = unsafe {
                                    MonitorFromWindow(
                                        GetForegroundWindow(),
                                        MONITOR_DEFAULTTOPRIMARY,
                                    )
                                };
                                if !cur_mon.0.is_null() && cur_mon != attached_mon {
                                    break;
                                }
                            }

                            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
                            let mut resource = None;
                            match unsafe { dupl.AcquireNextFrame(100, &mut info, &mut resource) } {
                                Ok(()) => {
                                    drop(resource);
                                    if info.LastPresentTime != 0 {
                                        let inc = info.AccumulatedFrames.max(1);
                                        frames_c.fetch_add(inc, Ordering::Relaxed);
                                    }
                                    let _ = unsafe { dupl.ReleaseFrame() };
                                }
                                Err(err) if err.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                                    continue;
                                }
                                Err(err) if err.code() == DXGI_ERROR_ACCESS_LOST => {
                                    avail_c.store(false, Ordering::Relaxed);
                                    std::thread::sleep(Duration::from_millis(250));
                                    break;
                                }
                                Err(_) => {
                                    avail_c.store(false, Ordering::Relaxed);
                                    std::thread::sleep(Duration::from_millis(400));
                                    break;
                                }
                            }
                        }
                    }
                });

            Self {
                frames,
                available,
                stop,
            }
        }

        pub fn take_fps(&self, elapsed_secs: f64) -> Option<u32> {
            let count = self.frames.swap(0, Ordering::Relaxed);
            if !self.available.load(Ordering::Relaxed) || elapsed_secs <= 0.05 {
                return None;
            }
            Some(((count as f64) / elapsed_secs).round().clamp(0.0, 999.0) as u32)
        }
    }

    impl Drop for FpsCollectorHandle {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_perf {
    use tauri::WebviewWindow;

    pub fn flush_compositor() {}

    pub fn show_perf_topmost_no_activate(win: &WebviewWindow, _position: &str) {
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.show();
    }

    pub struct CpuSampler;
    impl CpuSampler {
        pub fn new() -> Self { Self }
        pub fn sample(&mut self) -> u8 { 0 }
    }

    pub struct GpuSampler;
    impl GpuSampler {
        pub fn new() -> Self { Self }
        pub fn sample(&mut self) -> Option<u8> { None }
    }

    pub struct FpsCollectorHandle;
    impl FpsCollectorHandle {
        pub fn start() -> Self { Self }
        pub fn take_fps(&self, _elapsed_secs: f64) -> Option<u32> { None }
    }
}

pub fn ensure_perf_overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(PERF_OVERLAY_LABEL) {
        return Ok(existing);
    }

    let win = WebviewWindowBuilder::new(
        app,
        PERF_OVERLAY_LABEL,
        WebviewUrl::App("index.html?window=perf".into()),
    )
    .title("Estra Performance Overlay")
    .inner_size(PERF_WIDTH, PERF_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|e| format!("สร้างหน้าต่าง Performance Overlay ไม่สำเร็จ: {e}"))?;

    crate::security::lock_webview_window(&win);
    let _ = win.set_ignore_cursor_events(true);
    Ok(win)
}

pub fn hide_perf_overlay_window(app: &AppHandle) {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_clone.get_webview_window(PERF_OVERLAY_LABEL) {
            let _ = win.hide();
        }
    });
}

fn start_perf_worker(app: AppHandle, manager: PerfOverlayManager, gen: u64) {
    let _ = std::thread::Builder::new()
        .name("estra-perf-overlay".into())
        .spawn(move || {
            crate::security::hide_sensitive_thread();
            let mut cpu = win_perf::CpuSampler::new();
            let mut gpu = win_perf::GpuSampler::new();
            let fps_collector = win_perf::FpsCollectorHandle::start();
            let mut last_tick = Instant::now();
            let mut last_fivem_check = Instant::now() - Duration::from_secs(10);
            let mut cached_fivem_running = false;
            let mut last_position = String::new();

            std::thread::sleep(Duration::from_millis(350));

            while manager.is_current_generation(gen) {
                let cfg = manager.snapshot_settings();
                let elapsed = last_tick.elapsed().as_secs_f64();
                last_tick = Instant::now();

                if cfg.only_in_game && last_fivem_check.elapsed() >= Duration::from_millis(2200) {
                    last_fivem_check = Instant::now();
                    cached_fivem_running = crate::presence::get_fivem_sessions()
                        .map(|pids| !pids.is_empty())
                        .unwrap_or(false);
                } else if !cfg.only_in_game {
                    cached_fivem_running = false;
                }

                let should_display = !cfg.only_in_game || cached_fivem_running;
                let cpu_percent = cpu.sample();
                let gpu_percent = gpu.sample();
                let fps = fps_collector.take_fps(elapsed);
                let timestamp_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);

                let snap = PerfMetricsSnapshot {
                    fps,
                    cpu_percent,
                    gpu_percent,
                    fivem_running: cached_fivem_running,
                    position: cfg.position.clone(),
                    timestamp_ms,
                };
                manager.set_metrics(snap.clone());

                if should_display {
                    let was_vis = manager.currently_visible.swap(true, Ordering::SeqCst);
                    let pos_changed = last_position != cfg.position;
                    last_position = cfg.position.clone();
                    let app_ui = app.clone();
                    let pos_ui = cfg.position.clone();
                    if !was_vis || pos_changed {
                        let _ = app.run_on_main_thread(move || {
                            if let Ok(win) = ensure_perf_overlay_window(&app_ui) {
                                win_perf::show_perf_topmost_no_activate(&win, &pos_ui);
                            }
                        });
                    }
                    let _ = app.emit_to(PERF_OVERLAY_LABEL, "estra://perf-metrics", snap);
                } else if manager.currently_visible.swap(false, Ordering::SeqCst) {
                    hide_perf_overlay_window(&app);
                }

                for _ in 0..10 {
                    if !manager.is_current_generation(gen) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }

            if manager.generation.load(Ordering::SeqCst) == gen {
                manager.currently_visible.store(false, Ordering::SeqCst);
                hide_perf_overlay_window(&app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_perf_overlay_positions_safely() {
        assert_eq!(normalize_perf_position("top-left"), "top-left");
        assert_eq!(normalize_perf_position("TOP-RIGHT"), "top-right");
        assert_eq!(normalize_perf_position("bottom-left"), "bottom-left");
        assert_eq!(normalize_perf_position("bottom-right"), "bottom-right");
        assert_eq!(normalize_perf_position("invalid-pos"), "top-left");
    }

    #[test]
    fn computes_cpu_percent_from_system_time_deltas() {
        // Total delta = 1000 (kernel 600 + user 400), idle delta = 250 -> 75% busy
        assert_eq!(compute_cpu_percent(1000, 2000, 1000, 1250, 2600, 1400), Some(75));
        assert_eq!(compute_cpu_percent(100, 100, 100, 100, 100, 100), None);
        assert_eq!(compute_cpu_percent(100, 500, 200, 600, 1000, 200), Some(0));
    }

    #[test]
    fn aggregates_gpu_engine_utilization_by_engine_type() {
        let samples = [
            ("pid_100_luid_0x1_phys_0_eng_0_engtype_3D", 48.4),
            ("pid_200_luid_0x1_phys_0_eng_0_engtype_3D", 14.2),
            ("pid_300_luid_0x2_phys_0_eng_0_engtype_3D", 22.0),
            ("pid_100_luid_0x1_phys_0_eng_1_engtype_Copy", 12.0),
            ("bad_neg", -5.0),
            ("bad_nan", f64::NAN),
        ];
        // Adapter 0x1 3D sums to 62.6 -> rounds to 63; Adapter 0x2 3D stays separate (22); Copy is 12; max is 63.
        assert_eq!(aggregate_gpu_engine_utilization(&samples), 63);
    }

    #[test]
    fn computes_perf_window_origin_for_all_corners() {
        let area = (0, 0, 1920, 1040);
        assert_eq!(compute_perf_window_origin(area, 300, 48, 16, "top-left"), (16, 16));
        assert_eq!(compute_perf_window_origin(area, 300, 48, 16, "top-right"), (1604, 16));
        assert_eq!(compute_perf_window_origin(area, 300, 48, 16, "bottom-left"), (16, 976));
        assert_eq!(compute_perf_window_origin(area, 300, 48, 16, "bottom-right"), (1604, 976));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn live_windows_samplers_collect_without_error() {
        let mut cpu = win_perf::CpuSampler::new();
        let mut gpu = win_perf::GpuSampler::new();
        let fps = win_perf::FpsCollectorHandle::start();
        std::thread::sleep(Duration::from_millis(450));
        let cpu_val = cpu.sample();
        let gpu_val = gpu.sample();
        let fps_val = fps.take_fps(0.45);
        assert!(cpu_val <= 100);
        if let Some(g) = gpu_val {
            assert!(g <= 100);
        }
        if let Some(f) = fps_val {
            assert!(f <= 999);
        }
    }
}
