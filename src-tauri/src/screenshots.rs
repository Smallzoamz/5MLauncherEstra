use crate::file_safety::{assert_no_links, assert_within, normalize_win_path};
use crate::overlay::{push_overlay_notification, OverlayManager, OverlayNotificationPayload};
use crate::perf_overlay::{PerfOverlayCaptureGuard, PerfOverlayManager};
use crate::presence::get_fivem_sessions;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const META_FILE_NAME: &str = "screenshots-meta.json";
const MAX_SCREENSHOT_READ_BYTES: u64 = 25 * 1024 * 1024;
const DEFAULT_HOTKEY: &str = "F12";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default)]
    pub only_in_game: bool,
    #[serde(default)]
    pub include_perf_overlay: bool,
    #[serde(default)]
    pub dir: String,
    #[serde(default)]
    pub city_name: String,
}

fn default_true() -> bool {
    true
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.to_string()
}

impl Default for ScreenshotConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            hotkey: DEFAULT_HOTKEY.to_string(),
            only_in_game: false,
            include_perf_overlay: false,
            dir: String::new(),
            city_name: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotItem {
    pub filename: String,
    pub path: String,
    pub folder: String,
    pub created_at: u64,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub city_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotListResult {
    pub folder: String,
    pub items: Vec<ScreenshotItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureScreenshotResult {
    pub item: ScreenshotItem,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredShotMeta {
    city_name: String,
    width: u32,
    height: u32,
    created_at: u64,
}

#[derive(Clone, Default)]
pub struct ScreenshotManager {
    config: Arc<Mutex<ScreenshotConfig>>,
    capture_lock: Arc<Mutex<()>>,
}

impl ScreenshotManager {
    pub fn update_config(&self, mut next: ScreenshotConfig) -> Result<ScreenshotConfig, String> {
        let (_, _, canonical_hotkey) = parse_hotkey(&next.hotkey)?;
        next.hotkey = canonical_hotkey.to_string();
        next.dir = next.dir.trim().to_string();
        next.city_name = next.city_name.trim().chars().take(120).collect();

        let mut guard = self
            .config
            .lock()
            .map_err(|_| "ไม่สามารถอัปเดตการตั้งค่าจับภาพหน้าจอได้".to_string())?;
        if next.city_name.is_empty() && !guard.city_name.is_empty() {
            next.city_name = guard.city_name.clone();
        }
        *guard = next.clone();
        Ok(next)
    }

    pub fn set_city_name(&self, city_name: &str) {
        if let Ok(mut guard) = self.config.lock() {
            guard.city_name = city_name.trim().chars().take(120).collect();
        }
    }

    pub fn snapshot(&self) -> ScreenshotConfig {
        self.config
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }
}

pub fn parse_hotkey(spec: &str) -> Result<(bool, i32, &'static str), String> {
    let normalized = spec.trim().to_ascii_uppercase().replace(' ', "");
    match normalized.as_str() {
        "" | "F12" => Ok((false, 0x7B, "F12")),
        "F11" => Ok((false, 0x7A, "F11")),
        "F10" => Ok((false, 0x79, "F10")),
        "F9" => Ok((false, 0x78, "F9")),
        "PRINTSCREEN" | "PRTSCN" | "PRTSC" => Ok((false, 0x2C, "PrintScreen")),
        "CTRL+F12" => Ok((true, 0x7B, "Ctrl+F12")),
        "CTRL+F11" => Ok((true, 0x7A, "Ctrl+F11")),
        _ => Err("คีย์ลัดจับภาพหน้าจอรองรับ F9, F10, F11, F12, PrintScreen, Ctrl+F11 และ Ctrl+F12 เท่านั้น".into()),
    }
}

pub fn validate_screenshot_filename(filename: &str) -> Result<String, String> {
    let trimmed = filename.trim();
    if trimmed.len() < 5 || trimmed.len() > 120 {
        return Err("ชื่อไฟล์ภาพไม่ถูกต้อง".into());
    }
    if trimmed.starts_with('.') || trimmed.contains("..") {
        return Err("ชื่อไฟล์ภาพไม่อนุญาตให้มี .. หรือขึ้นต้นด้วยจุด".into());
    }
    if !trimmed.to_ascii_lowercase().ends_with(".png") {
        return Err("รองรับเฉพาะไฟล์ภาพ .png เท่านั้น".into());
    }
    if !trimmed
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err("ชื่อไฟล์ภาพมีอักขระที่ไม่อนุญาต".into());
    }
    Ok(trimmed.to_string())
}

pub fn validate_custom_dir(custom_dir: &str) -> Result<Option<PathBuf>, String> {
    let trimmed = custom_dir.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 260
        || trimmed.starts_with(r"\\")
        || trimmed.chars().any(|c| c.is_control())
    {
        return Err("พาธโฟลเดอร์เก็บรูปไม่ถูกต้อง".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("โฟลเดอร์เก็บรูปต้องเป็นพาธเต็ม เช่น D:\\EstraScreenshots".into());
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("โฟลเดอร์เก็บรูปไม่อนุญาตให้ใช้ ..".into());
    }
    Ok(Some(normalize_win_path(&path)))
}

pub fn resolve_screenshots_dir(app: &AppHandle, custom_dir: &str) -> Result<PathBuf, String> {
    let target = match validate_custom_dir(custom_dir)? {
        Some(dir) => dir,
        None => {
            let base = app
                .path()
                .app_local_data_dir()
                .map_err(|e| format!("ไม่สามารถระบุโฟลเดอร์โปรแกรมได้: {e}"))?;
            normalize_win_path(&base.join("screenshots"))
        }
    };
    assert_no_links(&target)?;
    fs::create_dir_all(&target)
        .map_err(|e| format!("สร้างโฟลเดอร์เก็บรูปไม่สำเร็จ: {e}"))?;
    assert_no_links(&target)?;
    Ok(target)
}

fn resolve_existing_screenshot_file(
    folder: &Path,
    filename: &str,
) -> Result<(String, PathBuf), String> {
    let clean = validate_screenshot_filename(filename)?;
    let target = normalize_win_path(&folder.join(&clean));
    assert_within(folder, &target)?;
    assert_no_links(&target)?;
    let meta = fs::symlink_metadata(&target)
        .map_err(|_| "ไม่พบไฟล์ภาพหน้าจอที่ระบุ".to_string())?;
    if !meta.is_file() {
        return Err("เป้าหมายไม่ใช่ไฟล์ภาพที่ถูกต้อง".into());
    }
    if meta.len() > MAX_SCREENSHOT_READ_BYTES {
        return Err("ไฟล์ภาพมีขนาดใหญ่เกินขีดจำกัดที่รองรับ".into());
    }
    Ok((clean, target))
}

fn read_meta_map(folder: &Path) -> HashMap<String, StoredShotMeta> {
    let meta_path = folder.join(META_FILE_NAME);
    if assert_no_links(&meta_path).is_err() {
        return HashMap::new();
    }
    let Ok(raw) = fs::read_to_string(&meta_path) else {
        return HashMap::new();
    };
    serde_json::from_str::<HashMap<String, StoredShotMeta>>(&raw).unwrap_or_default()
}

fn write_meta_map(folder: &Path, map: &HashMap<String, StoredShotMeta>) -> Result<(), String> {
    let meta_path = folder.join(META_FILE_NAME);
    let tmp_path = folder.join(format!("{META_FILE_NAME}.tmp"));
    let json = serde_json::to_string_pretty(map)
        .map_err(|e| format!("บันทึกข้อมูลภาพหน้าจอไม่สำเร็จ: {e}"))?;
    fs::write(&tmp_path, json).map_err(|e| format!("เขียนไฟล์ metadata ไม่สำเร็จ: {e}"))?;
    fs::rename(&tmp_path, &meta_path)
        .map_err(|e| format!("อัปเดตไฟล์ metadata ไม่สำเร็จ: {e}"))?;
    Ok(())
}

fn read_png_dimensions(path: &Path) -> (u32, u32) {
    let Ok(file) = fs::File::open(path) else {
        return (0, 0);
    };
    let decoder = png::Decoder::new(std::io::BufReader::new(file));
    match decoder.read_info() {
        Ok(reader) => {
            let info = reader.info();
            (info.width, info.height)
        }
        Err(_) => (0, 0),
    }
}

pub fn list_screenshots_in_dir(folder: &Path) -> Result<ScreenshotListResult, String> {
    assert_no_links(folder)?;
    fs::create_dir_all(folder).map_err(|e| format!("เปิดโฟลเดอร์ภาพไม่สำเร็จ: {e}"))?;
    let folder_str = normalize_win_path(folder).to_string_lossy().into_owned();
    let meta_map = read_meta_map(folder);
    let mut items = Vec::new();

    let entries = fs::read_dir(folder).map_err(|e| format!("อ่านรายการภาพหน้าจอไม่สำเร็จ: {e}"))?;
    for entry in entries.flatten() {
        let path = normalize_win_path(&entry.path());
        let Ok(file_meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !file_meta.is_file() {
            continue;
        }
        let Some(name_os) = path.file_name() else {
            continue;
        };
        let filename = name_os.to_string_lossy().into_owned();
        if validate_screenshot_filename(&filename).is_err() {
            continue;
        }
        let stored = meta_map.get(&filename);
        let fallback_ms = file_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let (width, height) = match stored {
            Some(m) if m.width > 0 && m.height > 0 => (m.width, m.height),
            _ => read_png_dimensions(&path),
        };
        items.push(ScreenshotItem {
            filename: filename.clone(),
            path: path.to_string_lossy().into_owned(),
            folder: folder_str.clone(),
            created_at: stored.map(|m| m.created_at).filter(|&t| t > 0).unwrap_or(fallback_ms),
            size_bytes: file_meta.len(),
            width,
            height,
            city_name: stored.map(|m| m.city_name.clone()).unwrap_or_default(),
        });
    }

    items.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.filename.cmp(&a.filename))
    });

    Ok(ScreenshotListResult {
        folder: folder_str,
        items,
    })
}

pub fn encode_rgba_to_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err("ขนาดข้อมูลภาพไม่ถูกต้อง".into());
    }
    let mut out = Vec::with_capacity((width as usize * height as usize) / 2);
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("สร้างส่วนหัว PNG ไม่สำเร็จ: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("เข้ารหัสไฟล์ PNG ไม่สำเร็จ: {e}"))?;
    }
    Ok(out)
}

pub fn bgra_to_rgba_opaque(bgra: &[u8]) -> Vec<u8> {
    let mut rgba = Vec::with_capacity(bgra.len());
    for px in bgra.chunks_exact(4) {
        rgba.push(px[2]);
        rgba.push(px[1]);
        rgba.push(px[0]);
        rgba.push(255);
    }
    rgba
}

pub fn scale_rgba_down(src_w: u32, src_h: u32, rgba: &[u8], max_width: u32) -> (u32, u32, Vec<u8>) {
    if src_w == 0 || src_h == 0 || max_width == 0 || src_w <= max_width {
        return (src_w, src_h, rgba.to_vec());
    }
    let dst_w = max_width.max(1);
    let dst_h = (((src_h as u64) * (dst_w as u64)) / (src_w as u64)).max(1) as u32;
    let mut out = vec![0u8; (dst_w as usize) * (dst_h as usize) * 4];
    for dy in 0..dst_h {
        let sy = ((dy as u64 * src_h as u64) / dst_h as u64).min(src_h as u64 - 1) as u32;
        for dx in 0..dst_w {
            let sx = ((dx as u64 * src_w as u64) / dst_w as u64).min(src_w as u64 - 1) as u32;
            let src_idx = ((sy as usize) * (src_w as usize) + (sx as usize)) * 4;
            let dst_idx = ((dy as usize) * (dst_w as usize) + (dx as usize)) * 4;
            out[dst_idx..dst_idx + 4].copy_from_slice(&rgba[src_idx..src_idx + 4]);
        }
    }
    (dst_w, dst_h, out)
}

pub fn decode_png_to_rgba(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("อ่านข้อมูลไฟล์ PNG ไม่ได้: {e}"))?;
    let buf_size = reader
        .output_buffer_size()
        .ok_or_else(|| "ไม่สามารถคำนวณขนาดภาพ PNG ได้".to_string())?;
    let mut buf = vec![0u8; buf_size];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("ถอดรหัสไฟล์ PNG ไม่สำเร็จ: {e}"))?;
    let raw = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => raw.to_vec(),
        png::ColorType::Rgb => {
            let mut out = Vec::with_capacity((info.width as usize) * (info.height as usize) * 4);
            for px in raw.chunks_exact(3) {
                out.extend_from_slice(&[px[0], px[1], px[2], 255]);
            }
            out
        }
        png::ColorType::Grayscale => {
            let mut out = Vec::with_capacity((info.width as usize) * (info.height as usize) * 4);
            for &g in raw {
                out.extend_from_slice(&[g, g, g, 255]);
            }
            out
        }
        png::ColorType::GrayscaleAlpha => {
            let mut out = Vec::with_capacity((info.width as usize) * (info.height as usize) * 4);
            for px in raw.chunks_exact(2) {
                out.extend_from_slice(&[px[0], px[0], px[0], px[1]]);
            }
            out
        }
        _ => return Err("รูปแบบสีของไฟล์ PNG ไม่รองรับ".into()),
    };
    Ok((info.width, info.height, rgba))
}

pub fn build_cf_dib_bytes(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err("ข้อมูลภาพสำหรับคัดลอกไม่ถูกต้อง".into());
    }
    let pixel_bytes = (width as usize) * (height as usize) * 4;
    let mut out = Vec::with_capacity(40 + pixel_bytes);
    out.extend_from_slice(&40u32.to_le_bytes()); // biSize
    out.extend_from_slice(&(width as i32).to_le_bytes()); // biWidth
    out.extend_from_slice(&(height as i32).to_le_bytes()); // biHeight > 0 => bottom-up
    out.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    out.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    out.extend_from_slice(&0u32.to_le_bytes()); // biCompression = BI_RGB
    out.extend_from_slice(&(pixel_bytes as u32).to_le_bytes()); // biSizeImage
    out.extend_from_slice(&0i32.to_le_bytes()); // biXPelsPerMeter
    out.extend_from_slice(&0i32.to_le_bytes()); // biYPelsPerMeter
    out.extend_from_slice(&0u32.to_le_bytes()); // biClrUsed
    out.extend_from_slice(&0u32.to_le_bytes()); // biClrImportant

    let row_stride = (width as usize) * 4;
    for y in (0..height as usize).rev() {
        let row = &rgba[y * row_stride..(y + 1) * row_stride];
        for px in row.chunks_exact(4) {
            out.push(px[2]);
            out.push(px[1]);
            out.push(px[0]);
            out.push(255);
        }
    }
    Ok(out)
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::{bgra_to_rgba_opaque, build_cf_dib_bytes};

    const MONITOR_DEFAULTTOPRIMARY: u32 = 1;
    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;
    const SRCCOPY: u32 = 0x00CC_0020;
    const CAPTUREBLT: u32 = 0x4000_0000;
    const DIB_RGB_COLORS: u32 = 0;
    const CF_DIB: u32 = 8;
    const GMEM_MOVEABLE: u32 = 0x0002;
    const VK_CONTROL: i32 = 0x11;

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

    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct SYSTEMTIME {
        w_year: u16,
        w_month: u16,
        w_day_of_week: u16,
        w_day: u16,
        w_hour: u16,
        w_minute: u16,
        w_second: u16,
        w_milliseconds: u16,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vKey: i32) -> i16;
        fn GetForegroundWindow() -> isize;
        fn MonitorFromWindow(hwnd: isize, dwFlags: u32) -> isize;
        fn GetMonitorInfoW(hMonitor: isize, lpmi: *mut MONITORINFO) -> i32;
        fn GetDC(hWnd: isize) -> isize;
        fn ReleaseDC(hWnd: isize, hDC: isize) -> i32;
        fn GetSystemMetrics(nIndex: i32) -> i32;
        fn OpenClipboard(hWndNewOwner: isize) -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(uFormat: u32, hMem: isize) -> isize;
        fn CloseClipboard() -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn DeleteDC(hdc: isize) -> i32;
        fn CreateCompatibleBitmap(hdc: isize, cx: i32, cy: i32) -> isize;
        fn SelectObject(hdc: isize, h: isize) -> isize;
        fn DeleteObject(ho: isize) -> i32;
        fn BitBlt(
            hdc: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            hdcSrc: isize,
            x1: i32,
            y1: i32,
            rop: u32,
        ) -> i32;
        fn GetDIBits(
            hdc: isize,
            hbm: isize,
            start: u32,
            cLines: u32,
            lpvBits: *mut u8,
            lpbmi: *mut BITMAPINFOHEADER,
            usage: u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLocalTime(lpSystemTime: *mut SYSTEMTIME);
        fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> isize;
        fn GlobalLock(hMem: isize) -> *mut u8;
        fn GlobalUnlock(hMem: isize) -> i32;
        fn GlobalFree(hMem: isize) -> isize;
    }

    struct ScreenDcGuard(isize);
    impl Drop for ScreenDcGuard {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    ReleaseDC(0, self.0);
                }
            }
        }
    }

    struct MemDcGuard(isize);
    impl Drop for MemDcGuard {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    DeleteDC(self.0);
                }
            }
        }
    }

    struct BitmapGuard(isize);
    impl Drop for BitmapGuard {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    DeleteObject(self.0);
                }
            }
        }
    }

    pub fn is_hotkey_pressed(require_ctrl: bool, vk: i32) -> bool {
        let main_down = unsafe { GetAsyncKeyState(vk) } < 0;
        if !main_down {
            return false;
        }
        if require_ctrl {
            return unsafe { GetAsyncKeyState(VK_CONTROL) } < 0;
        }
        true
    }

    pub fn local_timestamp_slug() -> String {
        let mut st = SYSTEMTIME::default();
        unsafe {
            GetLocalTime(&mut st);
        }
        format!(
            "{:04}-{:02}-{:02}_{:02}-{:02}-{:02}",
            st.w_year, st.w_month, st.w_day, st.w_hour, st.w_minute, st.w_second
        )
    }

    fn active_monitor_rect() -> (i32, i32, i32, i32) {
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
                let w = info.rc_monitor.right - info.rc_monitor.left;
                let h = info.rc_monitor.bottom - info.rc_monitor.top;
                if w > 0 && h > 0 {
                    return (info.rc_monitor.left, info.rc_monitor.top, w, h);
                }
            }
        }
        let w = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1);
        let h = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1);
        (0, 0, w, h)
    }

    pub fn capture_active_monitor_rgba() -> Result<(u32, u32, Vec<u8>), String> {
        let (x, y, width, height) = active_monitor_rect();
        if width <= 0 || height <= 0 || width > 16384 || height > 16384 {
            return Err("ขนาดหน้าจอไม่ถูกต้อง".into());
        }

        let screen_dc = ScreenDcGuard(unsafe { GetDC(0) });
        if screen_dc.0 == 0 {
            return Err("ไม่สามารถเข้าถึงหน้าจอเพื่อจับภาพได้".into());
        }

        let mem_dc = MemDcGuard(unsafe { CreateCompatibleDC(screen_dc.0) });
        if mem_dc.0 == 0 {
            return Err("ไม่สามารถสร้างหน่วยความจำกราฟิกสำหรับจับภาพได้".into());
        }

        let bitmap = BitmapGuard(unsafe { CreateCompatibleBitmap(screen_dc.0, width, height) });
        if bitmap.0 == 0 {
            return Err("ไม่สามารถสร้างบิตแมปสำหรับจับภาพหน้าจอได้".into());
        }

        let old_obj = unsafe { SelectObject(mem_dc.0, bitmap.0) };
        let blt_ok = unsafe {
            BitBlt(
                mem_dc.0,
                0,
                0,
                width,
                height,
                screen_dc.0,
                x,
                y,
                SRCCOPY | CAPTUREBLT,
            )
        };
        if blt_ok == 0 {
            unsafe {
                SelectObject(mem_dc.0, old_obj);
            }
            return Err("จับภาพหน้าจอไม่สำเร็จ (BitBlt ล้มเหลว)".into());
        }

        let mut bmi = BITMAPINFOHEADER {
            bi_size: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            bi_width: width,
            bi_height: -height, // top-down
            bi_planes: 1,
            bi_bit_count: 32,
            bi_compression: 0,
            bi_size_image: (width as u32) * (height as u32) * 4,
            bi_x_pels_per_meter: 0,
            bi_y_pels_per_meter: 0,
            bi_clr_used: 0,
            bi_clr_important: 0,
        };

        let mut bgra = vec![0u8; (width as usize) * (height as usize) * 4];
        let lines = unsafe {
            GetDIBits(
                mem_dc.0,
                bitmap.0,
                0,
                height as u32,
                bgra.as_mut_ptr(),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        };
        unsafe {
            SelectObject(mem_dc.0, old_obj);
        }

        if lines == 0 {
            return Err("ไม่สามารถอ่านพิกเซลจากหน้าจอได้".into());
        }

        Ok((width as u32, height as u32, bgra_to_rgba_opaque(&bgra)))
    }

    pub fn copy_rgba_to_clipboard(width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
        let dib = build_cf_dib_bytes(width, height, rgba)?;
        let hmem = unsafe { GlobalAlloc(GMEM_MOVEABLE, dib.len()) };
        if hmem == 0 {
            return Err("ไม่สามารถจองหน่วยความจำ Clipboard ได้".into());
        }

        let ptr = unsafe { GlobalLock(hmem) };
        if ptr.is_null() {
            unsafe {
                GlobalFree(hmem);
            }
            return Err("ไม่สามารถเขียนข้อมูลลงหน่วยความจำ Clipboard ได้".into());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(dib.as_ptr(), ptr, dib.len());
            GlobalUnlock(hmem);
        }

        if unsafe { OpenClipboard(0) } == 0 {
            unsafe {
                GlobalFree(hmem);
            }
            return Err("ไม่สามารถเปิด Clipboard ของ Windows ได้ในขณะนี้".into());
        }

        unsafe {
            EmptyClipboard();
        }
        let set_res = unsafe { SetClipboardData(CF_DIB, hmem) };
        unsafe {
            CloseClipboard();
        }
        if set_res == 0 {
            unsafe {
                GlobalFree(hmem);
            }
            return Err("คัดลอกภาพไปยัง Clipboard ไม่สำเร็จ".into());
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod win_impl {
    pub fn is_hotkey_pressed(_require_ctrl: bool, _vk: i32) -> bool {
        false
    }

    pub fn local_timestamp_slug() -> String {
        "screenshot".to_string()
    }

    pub fn capture_active_monitor_rgba() -> Result<(u32, u32, Vec<u8>), String> {
        Err("การจับภาพหน้าจอรองรับบน Windows เท่านั้น".into())
    }

    pub fn copy_rgba_to_clipboard(_width: u32, _height: u32, _rgba: &[u8]) -> Result<(), String> {
        Err("การคัดลอกภาพรองรับบน Windows เท่านั้น".into())
    }
}

fn next_unique_filename(folder: &Path, slug: &str) -> String {
    let base = format!("Estra_{slug}");
    let first = format!("{base}.png");
    if !folder.join(&first).exists() {
        return first;
    }
    for idx in 1..=999u32 {
        let candidate = format!("{base}_{idx:02}.png");
        if !folder.join(&candidate).exists() {
            return candidate;
        }
    }
    format!(
        "{base}_{}.png",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}

pub fn capture_screenshot_now(
    app: &AppHandle,
    manager: &ScreenshotManager,
    overlay: Option<&OverlayManager>,
    perf_overlay: Option<&PerfOverlayManager>,
) -> Result<CaptureScreenshotResult, String> {
    let _capture_guard = manager
        .capture_lock
        .lock()
        .map_err(|_| "ไม่สามารถจับภาพหน้าจอซ้อนกันได้".to_string())?;
    let cfg = manager.snapshot();
    let folder = resolve_screenshots_dir(app, &cfg.dir)?;
    let perf_guard = perf_overlay
        .map(|m| PerfOverlayCaptureGuard::prepare(app, m, cfg.include_perf_overlay));
    let capture_res = win_impl::capture_active_monitor_rgba();
    drop(perf_guard);
    let (width, height, rgba) = capture_res?;
    let png_bytes = encode_rgba_to_png(width, height, &rgba)?;

    let slug = win_impl::local_timestamp_slug();
    let filename = next_unique_filename(&folder, &slug);
    let target_path = normalize_win_path(&folder.join(&filename));
    assert_within(&folder, &target_path)?;
    assert_no_links(&target_path)?;

    let tmp_path = normalize_win_path(&folder.join(format!("{filename}.tmp")));
    fs::write(&tmp_path, &png_bytes)
        .map_err(|e| format!("บันทึกไฟล์ภาพหน้าจอไม่สำเร็จ: {e}"))?;
    fs::rename(&tmp_path, &target_path)
        .map_err(|e| format!("ย้ายไฟล์ภาพหน้าจอไม่สำเร็จ: {e}"))?;

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut meta_map = read_meta_map(&folder);
    meta_map.insert(
        filename.clone(),
        StoredShotMeta {
            city_name: cfg.city_name.clone(),
            width,
            height,
            created_at,
        },
    );
    let _ = write_meta_map(&folder, &meta_map);

    let item = ScreenshotItem {
        filename: filename.clone(),
        path: target_path.to_string_lossy().into_owned(),
        folder: folder.to_string_lossy().into_owned(),
        created_at,
        size_bytes: png_bytes.len() as u64,
        width,
        height,
        city_name: cfg.city_name,
    };

    let result = CaptureScreenshotResult {
        item: item.clone(),
        message: format!("บันทึกภาพหน้าจอแล้ว ({filename})"),
    };
    let _ = app.emit("estra://screenshot-captured", result.clone());

    if let Some(overlay_mgr) = overlay {
        if overlay_mgr.should_notify("screenshot") {
            let (sw, sh, scaled) = scale_rgba_down(width, height, &rgba, 160);
            let thumb_url = encode_rgba_to_png(sw, sh, &scaled)
                .map(|bytes| format!("data:image/png;base64,{}", BASE64.encode(bytes)))
                .unwrap_or_default();
            let detail_text = if item.city_name.is_empty() {
                format!("{width}×{height} · กดดูในแท็บคลังภาพ")
            } else {
                format!("{} · {width}×{height}", item.city_name)
            };
            let _ = push_overlay_notification(
                app,
                overlay_mgr,
                OverlayNotificationPayload {
                    id: format!("shot-{created_at}-{filename}"),
                    kind: "screenshot".to_string(),
                    badge: "บันทึกภาพหน้าจอแล้ว".to_string(),
                    title: filename.clone(),
                    subtitle: detail_text,
                    detail: cfg.hotkey.clone(),
                    image_url: thumb_url,
                    initials: "SHOT".to_string(),
                    accent_color: "#2b6bf3".to_string(),
                    duration_ms: 4200,
                },
                false,
            );
        }
    }

    Ok(result)
}

pub fn read_screenshot_data_url_by_dir(
    folder: &Path,
    filename: &str,
    max_width: Option<u32>,
) -> Result<String, String> {
    let (_, path) = resolve_existing_screenshot_file(folder, filename)?;
    let bytes = fs::read(&path).map_err(|e| format!("อ่านไฟล์ภาพหน้าจอไม่สำเร็จ: {e}"))?;

    if let Some(target_w) = max_width {
        if let Ok((w, h, rgba)) = decode_png_to_rgba(&bytes) {
            if w > target_w {
                let (sw, sh, scaled) = scale_rgba_down(w, h, &rgba, target_w);
                if let Ok(thumb_png) = encode_rgba_to_png(sw, sh, &scaled) {
                    return Ok(format!("data:image/png;base64,{}", BASE64.encode(thumb_png)));
                }
            }
        }
    }

    Ok(format!("data:image/png;base64,{}", BASE64.encode(bytes)))
}

pub fn copy_screenshot_to_clipboard_by_dir(folder: &Path, filename: &str) -> Result<(), String> {
    let (_, path) = resolve_existing_screenshot_file(folder, filename)?;
    let bytes = fs::read(&path).map_err(|e| format!("อ่านไฟล์ภาพหน้าจอไม่สำเร็จ: {e}"))?;
    let (w, h, rgba) = decode_png_to_rgba(&bytes)?;
    win_impl::copy_rgba_to_clipboard(w, h, &rgba)
}

pub fn delete_screenshot_by_dir(folder: &Path, filename: &str) -> Result<(), String> {
    let (clean, path) = resolve_existing_screenshot_file(folder, filename)?;
    fs::remove_file(&path).map_err(|e| format!("ลบไฟล์ภาพหน้าจอไม่สำเร็จ: {e}"))?;
    let mut meta_map = read_meta_map(folder);
    if meta_map.remove(&clean).is_some() {
        let _ = write_meta_map(folder, &meta_map);
    }
    Ok(())
}

pub fn open_screenshots_folder(app: &AppHandle, custom_dir: &str) -> Result<String, String> {
    let folder = resolve_screenshots_dir(app, custom_dir)?;
    let folder_str = normalize_win_path(&folder).to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(&folder_str)
            .spawn()
            .map_err(|e| format!("ไม่สามารถเปิดโฟลเดอร์เก็บรูปได้: {e}"))?;
        Ok(folder_str)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("รองรับการเปิดโฟลเดอร์อัตโนมัติบน Windows".into())
    }
}

pub fn start_hotkey_listener(
    app: AppHandle,
    manager: ScreenshotManager,
    overlay: OverlayManager,
    perf_overlay: PerfOverlayManager,
) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::thread::Builder::new()
            .name("estra-screenshot-hotkey".into())
            .spawn(move || {
                crate::security::hide_sensitive_thread();
                let mut was_down = false;
                let mut last_capture = Instant::now() - Duration::from_secs(5);
                let mut last_hotkey = String::new();

                loop {
                    let cfg = manager.snapshot();
                    if !cfg.enabled {
                        was_down = false;
                        std::thread::sleep(Duration::from_millis(150));
                        continue;
                    }

                    let Ok((require_ctrl, vk, canonical)) = parse_hotkey(&cfg.hotkey) else {
                        was_down = false;
                        std::thread::sleep(Duration::from_millis(150));
                        continue;
                    };

                    if canonical != last_hotkey {
                        was_down = false;
                        last_hotkey = canonical.to_string();
                    }

                    let is_down = win_impl::is_hotkey_pressed(require_ctrl, vk);
                    if is_down && !was_down && last_capture.elapsed() >= Duration::from_millis(350) {
                        last_capture = Instant::now();
                        let allow = if cfg.only_in_game {
                            get_fivem_sessions()
                                .map(|pids| !pids.is_empty())
                                .unwrap_or(false)
                        } else {
                            true
                        };
                        if allow {
                            if let Err(err) = capture_screenshot_now(&app, &manager, Some(&overlay), Some(&perf_overlay)) {
                                let _ = app.emit("estra://screenshot-error", err);
                            }
                        }
                    }
                    was_down = is_down;
                    std::thread::sleep(Duration::from_millis(25));
                }
            });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, manager, overlay, perf_overlay);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_hotkeys_and_rejects_unknown() {
        assert_eq!(parse_hotkey("f12").unwrap(), (false, 0x7B, "F12"));
        assert_eq!(parse_hotkey("ctrl + f12").unwrap(), (true, 0x7B, "Ctrl+F12"));
        assert_eq!(parse_hotkey("prtScn").unwrap(), (false, 0x2C, "PrintScreen"));
        assert!(parse_hotkey("Alt+Tab").is_err());
    }

    #[test]
    fn validates_screenshot_filenames_safely() {
        assert_eq!(
            validate_screenshot_filename("Estra_2026-11-15_13-10-00.png").unwrap(),
            "Estra_2026-11-15_13-10-00.png"
        );
        assert!(validate_screenshot_filename("../secret.png").is_err());
        assert!(validate_screenshot_filename("sub/shot.png").is_err());
        assert!(validate_screenshot_filename("shot.exe").is_err());
        assert!(validate_screenshot_filename(".hidden.png").is_err());
    }

    #[test]
    fn encodes_scales_and_builds_cf_dib() {
        let mut rgba = Vec::with_capacity(4 * 2 * 4);
        for _ in 0..8 {
            rgba.extend_from_slice(&[10, 20, 30, 255]);
        }
        let encoded = encode_rgba_to_png(4, 2, &rgba).unwrap();
        let (dw, dh, decoded) = decode_png_to_rgba(&encoded).unwrap();
        assert_eq!((dw, dh), (4, 2));
        assert_eq!(decoded, rgba);

        let (sw, sh, scaled) = scale_rgba_down(4, 2, &rgba, 2);
        assert_eq!((sw, sh), (2, 1));
        assert_eq!(scaled.len(), 8);

        let dib = build_cf_dib_bytes(4, 2, &rgba).unwrap();
        assert_eq!(dib.len(), 40 + 32);
        // R=10, G=20, B=30 -> DIB pixel is B=30, G=20, R=10, A=255
        assert_eq!(&dib[40..44], &[30, 20, 10, 255]);
    }

    #[test]
    fn lists_and_deletes_screenshots_in_temp_dir() {
        let base = std::env::temp_dir().join(format!(
            "estra_shots_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&base).unwrap();

        let rgba = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
        let png = encode_rgba_to_png(2, 2, &rgba).unwrap();
        fs::write(base.join("Estra_2026-11-15_10-00-00.png"), &png).unwrap();
        fs::write(base.join("notes.txt"), b"ignore").unwrap();

        let listed = list_screenshots_in_dir(&base).unwrap();
        assert_eq!(listed.items.len(), 1);
        assert_eq!(listed.items[0].filename, "Estra_2026-11-15_10-00-00.png");
        assert_eq!((listed.items[0].width, listed.items[0].height), (2, 2));

        let data_url =
            read_screenshot_data_url_by_dir(&base, "Estra_2026-11-15_10-00-00.png", None).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));

        delete_screenshot_by_dir(&base, "Estra_2026-11-15_10-00-00.png").unwrap();
        assert_eq!(list_screenshots_in_dir(&base).unwrap().items.len(), 0);

        let _ = fs::remove_dir_all(&base);
    }
}
