use crate::file_safety::{assert_no_links, assert_tree_no_links, assert_within, normalize_win_path};
use crate::presence::get_fivem_sessions;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

pub const VOICE_OVERLAY_LABEL: &str = "voice-note-overlay";
pub const VOICE_ADDON_ID: &str = "voice-to-note";
pub const VOICE_ADDON_VERSION: &str = "1.0.0";
const VOICE_OV_WIDTH: f64 = 420.0;
const VOICE_OV_HEIGHT: f64 = 520.0;
const VOICE_OV_MARGIN: i32 = 18;
const MANIFEST_FILE: &str = "manifest.json";
const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAddonManifest {
    pub id: String,
    pub version: String,
    pub installed_at: u64,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCorrectionPair {
    pub wrong: String,
    pub correct: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceNoteEntry {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub raw_text: String,
    #[serde(default = "default_game")]
    pub source: String,
    pub created_at: u64,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceNoteConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_game")]
    pub audio_source: String,
    #[serde(default = "default_engine")]
    pub stt_engine: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_custom_endpoint")]
    pub custom_endpoint: String,
    #[serde(default = "default_cloud_model")]
    pub cloud_model: String,
    #[serde(default = "default_local_model")]
    pub local_model_id: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_vad")]
    pub vad_sensitivity: f32,
    #[serde(default = "default_chunk_secs")]
    pub max_chunk_seconds: u8,
    #[serde(default = "default_true")]
    pub auto_apply_corrections: bool,
    #[serde(default = "default_hotkey")]
    pub toggle_overlay_hotkey: String,
    #[serde(default = "default_position")]
    pub overlay_position: String,
    #[serde(default = "default_dictionary")]
    pub custom_dictionary: Vec<String>,
    #[serde(default = "default_corrections")]
    pub corrections: Vec<VoiceCorrectionPair>,
    #[serde(default)]
    pub notes: Vec<VoiceNoteEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAddonState {
    pub installed: bool,
    pub manifest: Option<VoiceAddonManifest>,
    pub config: VoiceNoteConfig,
    pub listening: bool,
    pub overlay_visible: bool,
    pub local_engine_ready: bool,
    pub local_model_ready: bool,
    pub local_models_downloaded: Vec<String>,
    pub active_capture_label: String,
    pub install_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDownloadProgress {
    pub stage: String,
    pub percent: u8,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceMeterPayload {
    pub level: f32,
    pub speaking: bool,
    pub transcribing: bool,
    pub active_capture_label: String,
}

fn default_true() -> bool {
    true
}
fn default_game() -> String {
    "game".to_string()
}
fn default_engine() -> String {
    "cloud-groq".to_string()
}
fn default_custom_endpoint() -> String {
    "http://127.0.0.1:8080/v1/audio/transcriptions".to_string()
}
fn default_cloud_model() -> String {
    "whisper-large-v3-turbo".to_string()
}
fn default_local_model() -> String {
    "small-q5_1".to_string()
}
fn default_language() -> String {
    "th".to_string()
}
fn default_vad() -> f32 {
    0.014
}
fn default_chunk_secs() -> u8 {
    8
}
fn default_hotkey() -> String {
    "Alt+V".to_string()
}
fn default_position() -> String {
    "bottom-left".to_string()
}
fn default_dictionary() -> Vec<String> {
    vec![
        "โรลเพลย์".into(),
        "สภานักเรียน".into(),
        "setvoiceintent".into(),
        "reloadskin".into(),
        "reloadmap".into(),
    ]
}
fn default_corrections() -> Vec<VoiceCorrectionPair> {
    vec![
        VoiceCorrectionPair {
            wrong: "โลเพ".into(),
            correct: "โรลเพลย์".into(),
        },
        VoiceCorrectionPair {
            wrong: "โลลเพล".into(),
            correct: "โรลเพลย์".into(),
        },
        VoiceCorrectionPair {
            wrong: "สะพา".into(),
            correct: "สภา".into(),
        },
    ]
}

impl Default for VoiceNoteConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            audio_source: default_game(),
            stt_engine: default_engine(),
            api_key: String::new(),
            custom_endpoint: default_custom_endpoint(),
            cloud_model: default_cloud_model(),
            local_model_id: default_local_model(),
            language: default_language(),
            vad_sensitivity: default_vad(),
            max_chunk_seconds: default_chunk_secs(),
            auto_apply_corrections: true,
            toggle_overlay_hotkey: default_hotkey(),
            overlay_position: default_position(),
            custom_dictionary: default_dictionary(),
            corrections: default_corrections(),
            notes: Vec::new(),
        }
    }
}

pub fn parse_voice_hotkey(raw: &str) -> Result<(bool, bool, bool, i32, &'static str), String> {
    let normalized = raw.trim().to_ascii_uppercase().replace(' ', "");
    match normalized.as_str() {
        "" | "ALT+V" => Ok((false, true, false, 0x56, "Alt+V")),
        "CTRL+SHIFT+V" => Ok((true, false, true, 0x56, "Ctrl+Shift+V")),
        "F6" => Ok((false, false, false, 0x75, "F6")),
        "F10" => Ok((false, false, false, 0x79, "F10")),
        _ => Err("คีย์ลัด Voice To Note รองรับ Alt+V, Ctrl+Shift+V, F6 และ F10".into()),
    }
}

pub fn normalize_voice_position(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "top-left" | "topleft" => "top-left".to_string(),
        "top-right" | "topright" => "top-right".to_string(),
        "bottom-right" | "bottomright" => "bottom-right".to_string(),
        _ => "bottom-left".to_string(),
    }
}

pub fn local_model_spec(model_id: &str) -> (&'static str, &'static str, &'static str) {
    match model_id.trim() {
        "base" => (
            "base",
            "ggml-base.bin",
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        ),
        _ => (
            "small-q5_1",
            "ggml-small-q5_1.bin",
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
        ),
    }
}

pub fn sanitize_voice_config(mut cfg: VoiceNoteConfig) -> VoiceNoteConfig {
    cfg.audio_source = match cfg.audio_source.as_str() {
        "game" | "system" | "mic" | "both" => cfg.audio_source,
        _ => "game".to_string(),
    };
    cfg.stt_engine = match cfg.stt_engine.as_str() {
        "cloud-groq" | "cloud-openai" | "cloud-custom" | "local-whisper" => cfg.stt_engine,
        _ => "cloud-groq".to_string(),
    };
    cfg.api_key = cfg.api_key.trim().chars().take(300).collect();
    cfg.custom_endpoint = cfg.custom_endpoint.trim().chars().take(500).collect();
    if cfg.custom_endpoint.is_empty() {
        cfg.custom_endpoint = default_custom_endpoint();
    }
    cfg.cloud_model = cfg.cloud_model.trim().chars().take(80).collect();
    if cfg.cloud_model.is_empty() {
        cfg.cloud_model = match cfg.stt_engine.as_str() {
            "cloud-openai" => "whisper-1".to_string(),
            _ => default_cloud_model(),
        };
    }
    let (canon_model, _, _) = local_model_spec(&cfg.local_model_id);
    cfg.local_model_id = canon_model.to_string();
    cfg.language = match cfg.language.as_str() {
        "th" | "en" | "auto" => cfg.language,
        _ => "th".to_string(),
    };
    if !cfg.vad_sensitivity.is_finite() {
        cfg.vad_sensitivity = default_vad();
    }
    cfg.vad_sensitivity = cfg.vad_sensitivity.clamp(0.003, 0.15);
    cfg.max_chunk_seconds = cfg.max_chunk_seconds.clamp(4, 20);
    cfg.toggle_overlay_hotkey = parse_voice_hotkey(&cfg.toggle_overlay_hotkey)
        .map(|(_, _, _, _, canon)| canon.to_string())
        .unwrap_or_else(|_| default_hotkey());
    cfg.overlay_position = normalize_voice_position(&cfg.overlay_position);

    cfg.custom_dictionary = cfg
        .custom_dictionary
        .into_iter()
        .map(|w| w.trim().chars().take(60).collect::<String>())
        .filter(|w| !w.is_empty())
        .take(400)
        .collect();

    cfg.corrections = cfg
        .corrections
        .into_iter()
        .filter_map(|mut p| {
            p.wrong = p.wrong.trim().chars().take(60).collect();
            p.correct = p.correct.trim().chars().take(60).collect();
            if p.wrong.is_empty() || p.correct.is_empty() || p.wrong == p.correct {
                None
            } else {
                Some(p)
            }
        })
        .take(300)
        .collect();

    cfg.notes = cfg
        .notes
        .into_iter()
        .filter_map(|mut n| {
            n.text = n.text.trim().chars().take(4000).collect();
            if n.text.is_empty() {
                return None;
            }
            n.id = n.id.trim().chars().take(64).collect();
            if n.id.is_empty() {
                n.id = format!("note-{}", uuid::Uuid::new_v4());
            }
            n.raw_text = n.raw_text.trim().chars().take(4000).collect();
            n.source = match n.source.as_str() {
                "game" | "system" | "mic" => n.source,
                _ => "game".to_string(),
            };
            Some(n)
        })
        .take(200)
        .collect();

    cfg
}

pub fn resolve_voice_addon_dir_from_base(base: &Path) -> Result<PathBuf, String> {
    let addons_root = normalize_win_path(&base.join("addons"));
    let target = normalize_win_path(&addons_root.join(VOICE_ADDON_ID));
    assert_within(&addons_root, &target)?;
    assert_no_links(&target)?;
    Ok(target)
}

fn resolve_voice_addon_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("ไม่สามารถระบุโฟลเดอร์โปรแกรมได้: {e}"))?;
    resolve_voice_addon_dir_from_base(&base)
}

fn atomic_write_json<T: Serialize>(dir: &Path, filename: &str, value: &T) -> Result<(), String> {
    assert_no_links(dir)?;
    fs::create_dir_all(dir).map_err(|e| format!("สร้างโฟลเดอร์ Voice To Note ไม่สำเร็จ: {e}"))?;
    let target = normalize_win_path(&dir.join(filename));
    assert_within(dir, &target)?;
    assert_no_links(&target)?;
    let tmp = normalize_win_path(&dir.join(format!("{filename}.tmp")));
    assert_within(dir, &tmp)?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|e| format!("แปลงข้อมูล JSON ไม่สำเร็จ: {e}"))?;
    fs::write(&tmp, raw).map_err(|e| format!("เขียนไฟล์ Voice To Note ไม่สำเร็จ: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("บันทึกไฟล์ Voice To Note ไม่สำเร็จ: {e}"))?;
    Ok(())
}

pub fn load_voice_addon_from_dir(
    dir: &Path,
) -> Result<(bool, Option<VoiceAddonManifest>, VoiceNoteConfig), String> {
    if !dir.exists() {
        return Ok((false, None, VoiceNoteConfig::default()));
    }
    assert_no_links(dir)?;
    let manifest_path = normalize_win_path(&dir.join(MANIFEST_FILE));
    if !manifest_path.is_file() {
        return Ok((false, None, VoiceNoteConfig::default()));
    }
    assert_no_links(&manifest_path)?;
    let raw_man = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("อ่านข้อมูล Voice To Note ไม่สำเร็จ: {e}"))?;
    let manifest: VoiceAddonManifest = serde_json::from_str(&raw_man)
        .map_err(|e| format!("manifest ของ Voice To Note เสียหาย: {e}"))?;

    let cfg_path = normalize_win_path(&dir.join(CONFIG_FILE));
    let config = if cfg_path.is_file() && assert_no_links(&cfg_path).is_ok() {
        fs::read_to_string(&cfg_path)
            .ok()
            .and_then(|s| serde_json::from_str::<VoiceNoteConfig>(&s).ok())
            .map(sanitize_voice_config)
            .unwrap_or_default()
    } else {
        VoiceNoteConfig::default()
    };

    Ok((true, Some(manifest), config))
}

pub fn install_voice_addon_in_dir(
    dir: &Path,
) -> Result<(VoiceAddonManifest, VoiceNoteConfig), String> {
    assert_no_links(dir)?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let manifest = VoiceAddonManifest {
        id: VOICE_ADDON_ID.to_string(),
        version: VOICE_ADDON_VERSION.to_string(),
        installed_at: now_ms,
        enabled: true,
    };
    let config = VoiceNoteConfig::default();
    atomic_write_json(dir, MANIFEST_FILE, &manifest)?;
    atomic_write_json(dir, CONFIG_FILE, &config)?;
    Ok((manifest, config))
}

pub fn uninstall_voice_addon_in_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    assert_no_links(dir)?;
    assert_tree_no_links(dir).map_err(|e| e.to_string())?;
    fs::remove_dir_all(dir).map_err(|e| format!("ลบโฟลเดอร์ Voice To Note ไม่สำเร็จ: {e}"))?;
    Ok(())
}

pub fn mix_and_resample_to_16khz(
    raw_bytes: &[u8],
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u16,
    is_float: bool,
) -> Vec<i16> {
    let ch = channels.max(1) as usize;
    if sample_rate == 0 || raw_bytes.is_empty() {
        return Vec::new();
    }

    let bytes_per_sample = (bits_per_sample / 8).max(1) as usize;
    let frame_stride = ch * bytes_per_sample;
    let frame_count = raw_bytes.len() / frame_stride;
    if frame_count == 0 {
        return Vec::new();
    }

    let mut mono: Vec<f32> = Vec::with_capacity(frame_count);
    for f in 0..frame_count {
        let mut sum = 0.0_f32;
        for c in 0..ch {
            let offset = f * frame_stride + c * bytes_per_sample;
            let sample_f = if is_float && bits_per_sample == 32 && offset + 4 <= raw_bytes.len() {
                f32::from_le_bytes([
                    raw_bytes[offset],
                    raw_bytes[offset + 1],
                    raw_bytes[offset + 2],
                    raw_bytes[offset + 3],
                ])
            } else if !is_float && bits_per_sample == 16 && offset + 2 <= raw_bytes.len() {
                i16::from_le_bytes([raw_bytes[offset], raw_bytes[offset + 1]]) as f32 / 32768.0
            } else if !is_float && bits_per_sample == 32 && offset + 4 <= raw_bytes.len() {
                i32::from_le_bytes([
                    raw_bytes[offset],
                    raw_bytes[offset + 1],
                    raw_bytes[offset + 2],
                    raw_bytes[offset + 3],
                ]) as f32
                    / 2147483648.0
            } else {
                0.0
            };
            sum += if sample_f.is_finite() { sample_f } else { 0.0 };
        }
        mono.push((sum / ch as f32).clamp(-1.0, 1.0));
    }

    if sample_rate == 16_000 {
        return mono
            .into_iter()
            .map(|s| (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16)
            .collect();
    }

    let out_len = ((mono.len() as f64) * 16_000.0 / (sample_rate as f64)).floor() as usize;
    if out_len == 0 {
        return Vec::new();
    }
    let ratio = (sample_rate as f64) / 16_000.0;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = (i as f64) * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let s0 = mono[idx.min(mono.len() - 1)];
        let s1 = mono[(idx + 1).min(mono.len() - 1)];
        let interp = s0 + (s1 - s0) * frac;
        out.push((interp * 32767.0).round().clamp(-32768.0, 32767.0) as i16);
    }
    out
}

pub fn compute_rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples
        .iter()
        .map(|&s| {
            let n = (s as f64) / 32768.0;
            n * n
        })
        .sum();
    ((sum_sq / samples.len() as f64).sqrt() as f32).clamp(0.0, 1.0)
}

pub fn encode_pcm16_wav_16k(samples: &[i16]) -> Vec<u8> {
    let data_bytes = (samples.len() * 2) as u32;
    let riff_size = 36 + data_bytes;
    let mut buf = Vec::with_capacity(44 + data_bytes as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&riff_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16_u32.to_le_bytes()); // PCM chunk size
    buf.extend_from_slice(&1_u16.to_le_bytes()); // PCM format
    buf.extend_from_slice(&1_u16.to_le_bytes()); // Mono
    buf.extend_from_slice(&16_000_u32.to_le_bytes()); // Sample rate
    buf.extend_from_slice(&(16_000_u32 * 2).to_le_bytes()); // Byte rate
    buf.extend_from_slice(&2_u16.to_le_bytes()); // Block align
    buf.extend_from_slice(&16_u16.to_le_bytes()); // Bits per sample
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_bytes.to_le_bytes());
    for &s in samples {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    buf
}

pub fn apply_text_corrections(raw_text: &str, corrections: &[VoiceCorrectionPair]) -> String {
    let mut out = raw_text.trim().to_string();
    if out.is_empty() {
        return out;
    }
    let mut sorted = corrections.to_vec();
    sorted.sort_by(|a, b| b.wrong.len().cmp(&a.wrong.len()));
    for pair in sorted {
        if !pair.wrong.is_empty() && out.contains(&pair.wrong) {
            out = out.replace(&pair.wrong, &pair.correct);
        }
    }
    out
}

pub fn build_whisper_prompt(dict: &[String]) -> String {
    let mut items = Vec::new();
    for w in dict.iter().take(45) {
        let t = w.trim();
        if !t.is_empty() {
            items.push(t);
        }
    }
    items.join(", ").chars().take(500).collect()
}

fn is_whisper_silence_artifact(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "." | ".." | "..." | "you" | "thank you." | "thanks for watching." | "mbc 뉴스" | "sous-titres"
    ) || matches!(trimmed, "ขอบคุณครับ" | "ขอบคุณค่ะ" | "ขอบคุณที่รับชม")
        && trimmed.chars().count() <= 14
}

fn check_local_files(dir: &Path, model_id: &str) -> (bool, bool, Vec<String>) {
    let bin_exe = dir.join("bin").join("whisper-cli.exe");
    let engine_ready = bin_exe.is_file();
    let models_dir = dir.join("models");
    let mut downloaded = Vec::new();
    for id in ["small-q5_1", "base"] {
        let (_, fname, _) = local_model_spec(id);
        if models_dir.join(fname).is_file() {
            downloaded.push(id.to_string());
        }
    }
    let (_, active_fname, _) = local_model_spec(model_id);
    let model_ready = models_dir.join(active_fname).is_file();
    (engine_ready, model_ready, downloaded)
}

#[derive(Clone, Default)]
pub struct VoiceNoteManager {
    installed: Arc<AtomicBool>,
    manifest: Arc<Mutex<Option<VoiceAddonManifest>>>,
    config: Arc<Mutex<VoiceNoteConfig>>,
    listening: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
    overlay_visible: Arc<AtomicBool>,
    prev_fg_hwnd: Arc<AtomicIsize>,
    active_capture_label: Arc<Mutex<String>>,
    hotkey_running: Arc<AtomicBool>,
}

impl VoiceNoteManager {
    pub fn init_from_disk(&self, app: &AppHandle) {
        let Ok(dir) = resolve_voice_addon_dir(app) else {
            return;
        };
        if let Ok((installed, manifest, config)) = load_voice_addon_from_dir(&dir) {
            self.installed.store(installed, Ordering::SeqCst);
            if let Ok(mut guard) = self.manifest.lock() {
                *guard = manifest;
            }
            if let Ok(mut guard) = self.config.lock() {
                *guard = config;
            }
            if installed {
                self.ensure_hotkey_worker(app);
            }
        }
    }

    pub fn snapshot_state(&self, app: Option<&AppHandle>) -> VoiceAddonState {
        let installed = self.installed.load(Ordering::SeqCst);
        let cfg = self.snapshot_config();
        let dir_opt = app.and_then(|a| resolve_voice_addon_dir(a).ok());
        let (local_engine_ready, local_model_ready, local_models_downloaded) = match (&dir_opt, installed) {
            (Some(d), true) => check_local_files(d, &cfg.local_model_id),
            _ => (false, false, Vec::new()),
        };
        let install_dir = dir_opt
            .filter(|_| installed)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();

        VoiceAddonState {
            installed,
            manifest: self.manifest.lock().ok().and_then(|g| g.clone()),
            config: cfg,
            listening: self.listening.load(Ordering::SeqCst),
            overlay_visible: self.overlay_visible.load(Ordering::SeqCst),
            local_engine_ready,
            local_model_ready,
            local_models_downloaded,
            active_capture_label: self
                .active_capture_label
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default(),
            install_dir,
        }
    }

    pub fn snapshot_config(&self) -> VoiceNoteConfig {
        self.config.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn is_installed(&self) -> bool {
        self.installed.load(Ordering::SeqCst)
    }

    fn emit_state(&self, app: &AppHandle) {
        let state = self.snapshot_state(Some(app));
        let _ = app.emit("estra://voice-note-state", state);
    }

    fn ensure_hotkey_worker(&self, app: &AppHandle) {
        if !self.installed.load(Ordering::SeqCst) {
            return;
        }
        if !self.hotkey_running.swap(true, Ordering::SeqCst) {
            start_voice_hotkey_worker(app.clone(), self.clone());
        }
    }

    pub fn install(&self, app: &AppHandle) -> Result<VoiceAddonState, String> {
        let dir = resolve_voice_addon_dir(app)?;
        let (manifest, config) = install_voice_addon_in_dir(&dir)?;
        if let Ok(mut guard) = self.manifest.lock() {
            *guard = Some(manifest);
        }
        if let Ok(mut guard) = self.config.lock() {
            *guard = config;
        }
        self.installed.store(true, Ordering::SeqCst);
        self.listening.store(false, Ordering::SeqCst);
        self.ensure_hotkey_worker(app);
        self.emit_state(app);
        Ok(self.snapshot_state(Some(app)))
    }

    pub fn uninstall(&self, app: &AppHandle) -> Result<VoiceAddonState, String> {
        self.stop_capture(app);
        self.installed.store(false, Ordering::SeqCst);
        self.overlay_visible.store(false, Ordering::SeqCst);
        hide_voice_overlay_internal(app, self, false);

        let app_ui = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(win) = app_ui.get_webview_window(VOICE_OVERLAY_LABEL) {
                let _ = win.close();
            }
        });

        let dir = resolve_voice_addon_dir(app)?;
        uninstall_voice_addon_in_dir(&dir)?;
        if let Ok(mut guard) = self.manifest.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.config.lock() {
            *guard = VoiceNoteConfig::default();
        }
        self.emit_state(app);
        Ok(self.snapshot_state(Some(app)))
    }

    pub fn update_config(
        &self,
        app: &AppHandle,
        next: VoiceNoteConfig,
    ) -> Result<VoiceAddonState, String> {
        if !self.installed.load(Ordering::SeqCst) {
            return Err("กรุณาติดตั้ง Voice To Note ก่อนปรับตั้งค่า".into());
        }
        let clean = sanitize_voice_config(next);
        let dir = resolve_voice_addon_dir(app)?;
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
        if !clean.enabled {
            self.stop_capture(app);
            if self.overlay_visible.load(Ordering::SeqCst) {
                hide_voice_overlay_internal(app, self, false);
            }
        }
        self.ensure_hotkey_worker(app);
        self.emit_state(app);
        Ok(self.snapshot_state(Some(app)))
    }

    pub fn append_note_entry(&self, app: &AppHandle, entry: VoiceNoteEntry) {
        let Ok(dir) = resolve_voice_addon_dir(app) else {
            return;
        };
        if !self.is_installed() {
            return;
        }
        let mut updated_cfg = None;
        if let Ok(mut guard) = self.config.lock() {
            guard.notes.insert(0, entry.clone());
            if guard.notes.len() > 200 {
                guard.notes.truncate(200);
            }
            updated_cfg = Some(guard.clone());
        }
        if let Some(cfg) = updated_cfg {
            let _ = atomic_write_json(&dir, CONFIG_FILE, &cfg);
        }
        let _ = app.emit("estra://voice-note-transcript", entry);
        self.emit_state(app);
    }

    pub fn toggle_overlay(&self, app: &AppHandle, desired: Option<bool>) -> Result<bool, String> {
        if !self.installed.load(Ordering::SeqCst) {
            return Err("ยังไม่ได้ติดตั้ง Voice To Note".into());
        }
        let cfg = self.snapshot_config();
        let currently_visible = app
            .get_webview_window(VOICE_OVERLAY_LABEL)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        let target = desired.unwrap_or(!currently_visible);
        if target {
            if !cfg.enabled {
                return Err("กรุณาเปิดใช้งาน Voice To Note ก่อนเปิดหน้าต่าง".into());
            }
            show_voice_overlay_internal(app, self, &cfg.overlay_position)?;
            self.overlay_visible.store(true, Ordering::SeqCst);
        } else {
            hide_voice_overlay_internal(app, self, true);
            self.overlay_visible.store(false, Ordering::SeqCst);
        }
        self.emit_state(app);
        Ok(target)
    }

    pub fn start_capture(&self, app: &AppHandle) -> Result<VoiceAddonState, String> {
        if !self.installed.load(Ordering::SeqCst) {
            return Err("กรุณาติดตั้ง Voice To Note ก่อนเริ่มใช้งาน".into());
        }
        let cfg = self.snapshot_config();
        if !cfg.enabled {
            return Err("Voice To Note ถูกพักการทำงานอยู่ กรุณาเปิดใช้งานก่อน".into());
        }
        validate_stt_readiness(app, &cfg)?;

        if self.listening.swap(true, Ordering::SeqCst) {
            return Ok(self.snapshot_state(Some(app)));
        }
        self.stop_flag.store(false, Ordering::SeqCst);
        spawn_audio_capture_worker(app.clone(), self.clone());
        self.emit_state(app);
        Ok(self.snapshot_state(Some(app)))
    }

    pub fn stop_capture(&self, app: &AppHandle) -> VoiceAddonState {
        self.stop_flag.store(true, Ordering::SeqCst);
        self.listening.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.active_capture_label.lock() {
            guard.clear();
        }
        let _ = app.emit(
            "estra://voice-note-meter",
            VoiceMeterPayload {
                level: 0.0,
                speaking: false,
                transcribing: false,
                active_capture_label: String::new(),
            },
        );
        self.emit_state(app);
        self.snapshot_state(Some(app))
    }
}

fn validate_stt_readiness(app: &AppHandle, cfg: &VoiceNoteConfig) -> Result<(), String> {
    match cfg.stt_engine.as_str() {
        "cloud-groq" => {
            if cfg.api_key.trim().is_empty() {
                return Err("กรุณาใส่ Groq API Key ในแถบตั้งค่า Engine หรือสลับไปใช้ Local Whisper".into());
            }
        }
        "cloud-openai" => {
            if cfg.api_key.trim().is_empty() {
                return Err("กรุณาใส่ OpenAI API Key ในแถบตั้งค่า Engine".into());
            }
        }
        "cloud-custom" => {
            let parsed = Url::parse(cfg.custom_endpoint.trim())
                .map_err(|_| "Custom Endpoint URL ไม่ถูกต้อง".to_string())?;
            let is_local = parsed.scheme() == "http"
                && matches!(parsed.host_str(), Some("127.0.0.1") | Some("localhost"));
            if parsed.scheme() != "https" && !is_local {
                return Err("Custom Endpoint ต้องใช้ HTTPS (ยกเว้น localhost / 127.0.0.1)".into());
            }
        }
        "local-whisper" => {
            let dir = resolve_voice_addon_dir(app)?;
            let (engine_ok, model_ok, _) = check_local_files(&dir, &cfg.local_model_id);
            if !engine_ok || !model_ok {
                return Err(
                    "ยังไม่ได้ดาวน์โหลด Local Whisper Engine หรือโมเดลภาษาไทย กรุณากดดาวน์โหลดในแท็บตั้งค่า Engine ก่อน".into(),
                );
            }
        }
        _ => {}
    }
    Ok(())
}

async fn download_to_file_with_progress(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    stage: &str,
    label: &str,
) -> Result<(), String> {
    let resp = client
        .get(url)
        .header("User-Agent", "Estra-FiveM-Launcher")
        .send()
        .await
        .map_err(|e| format!("ดาวน์โหลด {label} ไม่สำเร็จ: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ดาวน์โหลด {label} ล้มเหลว (HTTP {})", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("download.tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| format!("สร้างไฟล์ {label} ไม่สำเร็จ: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_pct: i16 = -1;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("รับข้อมูล {label} ขัดข้อง: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("เขียนไฟล์ {label} ไม่สำเร็จ: {e}"))?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = ((downloaded as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as i16;
            if pct != last_pct && (pct % 2 == 0 || pct == 100) {
                last_pct = pct;
                let _ = app.emit(
                    "estra://voice-note-download",
                    VoiceDownloadProgress {
                        stage: stage.to_string(),
                        percent: pct as u8,
                        message: format!(
                            "กำลังดาวน์โหลด {label} ({:.1} / {:.1} MB)",
                            downloaded as f64 / 1_048_576.0,
                            total as f64 / 1_048_576.0
                        ),
                    },
                );
            }
        }
    }
    file.flush().map_err(|e| format!("บันทึกไฟล์ {label} ไม่สำเร็จ: {e}"))?;
    drop(file);
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    fs::rename(&tmp, dest).map_err(|e| format!("ย้ายไฟล์ {label} ไม่สำเร็จ: {e}"))?;
    Ok(())
}

pub async fn download_local_whisper_runtime(
    app: &AppHandle,
    manager: &VoiceNoteManager,
    model_id: String,
) -> Result<VoiceAddonState, String> {
    if !manager.is_installed() {
        return Err("กรุณาติดตั้ง Add-on Voice To Note ก่อน".into());
    }
    let dir = resolve_voice_addon_dir(app)?;
    assert_no_links(&dir)?;
    let bin_dir = normalize_win_path(&dir.join("bin"));
    let models_dir = normalize_win_path(&dir.join("models"));
    fs::create_dir_all(&bin_dir).map_err(|e| format!("สร้างโฟลเดอร์ bin ไม่สำเร็จ: {e}"))?;
    fs::create_dir_all(&models_dir).map_err(|e| format!("สร้างโฟลเดอร์ models ไม่สำเร็จ: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("สร้าง HTTP client ไม่สำเร็จ: {e}"))?;

    // 1. Download whisper-cli.exe package if not already present
    if !bin_dir.join("whisper-cli.exe").is_file() {
        let _ = app.emit(
            "estra://voice-note-download",
            VoiceDownloadProgress {
                stage: "engine".into(),
                percent: 5,
                message: "กำลังตรวจสอบเวอร์ชันล่าสุดของ whisper.cpp...".into(),
            },
        );
        let rel_json: serde_json::Value = client
            .get("https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest")
            .header("User-Agent", "Estra-FiveM-Launcher")
            .send()
            .await
            .map_err(|e| format!("ตรวจสอบ GitHub Release ไม่สำเร็จ: {e}"))?
            .json()
            .await
            .map_err(|e| format!("อ่านข้อมูล Release ไม่สำเร็จ: {e}"))?;

        let assets = rel_json["assets"]
            .as_array()
            .ok_or_else(|| "ไม่พบรายการไฟล์ใน whisper.cpp release".to_string())?;
        let asset_url = assets
            .iter()
            .find_map(|a| {
                let name = a["name"].as_str()?;
                if name.eq_ignore_ascii_case("whisper-bin-x64.zip") {
                    a["browser_download_url"].as_str().map(String::from)
                } else {
                    None
                }
            })
            .ok_or_else(|| "ไม่พบไฟล์ whisper-bin-x64.zip สำหรับ Windows x64".to_string())?;

        let zip_path = bin_dir.join("whisper-bin-x64.zip");
        download_to_file_with_progress(
            app,
            &client,
            &asset_url,
            &zip_path,
            "engine",
            "Local Whisper Engine (x64)",
        )
        .await?;

        let _ = app.emit(
            "estra://voice-note-download",
            VoiceDownloadProgress {
                stage: "engine".into(),
                percent: 95,
                message: "กำลังแตกไฟล์ Local Whisper Engine...".into(),
            },
        );

        let zip_file = fs::File::open(&zip_path)
            .map_err(|e| format!("เปิดไฟล์ zip ไม่สำเร็จ: {e}"))?;
        let mut archive = zip::ZipArchive::new(zip_file)
            .map_err(|e| format!("อ่านไฟล์ zip ไม่สำเร็จ: {e}"))?;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("อ่านรายการใน zip ไม่สำเร็จ: {e}"))?;
            if entry.is_dir() {
                continue;
            }
            let Some(enclosed) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
                continue;
            };
            let Some(fname) = enclosed.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            let lower = fname.to_ascii_lowercase();
            if lower != "whisper-cli.exe" && !lower.ends_with(".dll") {
                continue;
            }
            let out_path = normalize_win_path(&bin_dir.join(fname));
            assert_within(&bin_dir, &out_path)?;
            assert_no_links(&out_path)?;
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("แตกไฟล์ {fname} ไม่สำเร็จ: {e}"))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("คัดลอก {fname} ไม่สำเร็จ: {e}"))?;
        }
        let _ = fs::remove_file(&zip_path);
        if !bin_dir.join("whisper-cli.exe").is_file() {
            return Err("ไม่พบ whisper-cli.exe หลังแตกไฟล์".into());
        }
    }

    // 2. Download GGML model file if missing
    let (canon_id, model_fname, model_url) = local_model_spec(&model_id);
    let model_dest = normalize_win_path(&models_dir.join(model_fname));
    assert_within(&models_dir, &model_dest)?;
    if !model_dest.is_file() {
        download_to_file_with_progress(
            app,
            &client,
            model_url,
            &model_dest,
            "model",
            &format!("โมเดล Whisper ({canon_id})"),
        )
        .await?;
    }

    let _ = app.emit(
        "estra://voice-note-download",
        VoiceDownloadProgress {
            stage: "done".into(),
            percent: 100,
            message: "ติดตั้ง Local Whisper Engine และโมเดลพร้อมใช้งานแล้ว".into(),
        },
    );
    manager.emit_state(app);
    Ok(manager.snapshot_state(Some(app)))
}

async fn transcribe_wav_chunk(
    app: &AppHandle,
    cfg: &VoiceNoteConfig,
    wav_bytes: Vec<u8>,
) -> Result<String, String> {
    let prompt = build_whisper_prompt(&cfg.custom_dictionary);
    match cfg.stt_engine.as_str() {
        "local-whisper" => {
            let dir = resolve_voice_addon_dir(app)?;
            let exe = dir.join("bin").join("whisper-cli.exe");
            let (_, fname, _) = local_model_spec(&cfg.local_model_id);
            let model_path = dir.join("models").join(fname);
            if !exe.is_file() || !model_path.is_file() {
                return Err("ไม่พบ Local Whisper Engine หรือโมเดล".into());
            }
            let tmp_dir = dir.join("tmp");
            fs::create_dir_all(&tmp_dir)
                .map_err(|e| format!("สร้างโฟลเดอร์ชั่วคราวไม่สำเร็จ: {e}"))?;
            let wav_path = tmp_dir.join(format!("chunk-{}.wav", uuid::Uuid::new_v4()));
            fs::write(&wav_path, &wav_bytes)
                .map_err(|e| format!("เขียนไฟล์เสียงชั่วคราวไม่สำเร็จ: {e}"))?;

            let lang = if cfg.language == "auto" {
                "auto".to_string()
            } else {
                cfg.language.clone()
            };

            let res = tokio::task::spawn_blocking(move || {
                struct TempCleanup(PathBuf);
                impl Drop for TempCleanup {
                    fn drop(&mut self) {
                        let _ = fs::remove_file(&self.0);
                    }
                }
                let _guard = TempCleanup(wav_path.clone());

                let mut cmd = std::process::Command::new(&exe);
                cmd.arg("-m")
                    .arg(&model_path)
                    .arg("-l")
                    .arg(&lang)
                    .arg("-f")
                    .arg(&wav_path)
                    .arg("-nt")
                    .arg("--no-prints");
                if !prompt.is_empty() {
                    cmd.arg("--prompt").arg(&prompt);
                }
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                let output = cmd
                    .output()
                    .map_err(|e| format!("รัน whisper-cli.exe ไม่สำเร็จ: {e}"))?;
                if !output.status.success() {
                    let err_txt = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("Local Whisper ถอดความไม่สำเร็จ: {err_txt}"));
                }
                let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Ok(text)
            })
            .await
            .map_err(|_| "ประมวลผลเสียงขัดข้อง".to_string())??;
            Ok(res)
        }
        engine => {
            let endpoint = match engine {
                "cloud-openai" => "https://api.openai.com/v1/audio/transcriptions",
                "cloud-custom" => cfg.custom_endpoint.trim(),
                _ => "https://api.groq.com/openai/v1/audio/transcriptions",
            };
            let part = reqwest::multipart::Part::bytes(wav_bytes)
                .file_name("speech.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("เตรียมไฟล์เสียงไม่สำเร็จ: {e}"))?;
            let mut form = reqwest::multipart::Form::new()
                .part("file", part)
                .text("model", cfg.cloud_model.clone())
                .text("response_format", "json");
            if cfg.language != "auto" {
                form = form.text("language", cfg.language.clone());
            }
            if !prompt.is_empty() {
                form = form.text("prompt", prompt);
            }

            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|e| format!("สร้าง HTTP client ไม่สำเร็จ: {e}"))?;
            let mut req = client.post(endpoint).multipart(form);
            if !cfg.api_key.trim().is_empty() {
                req = req.bearer_auth(cfg.api_key.trim());
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("ส่งเสียงไปถอดความไม่สำเร็จ: {e}"))?;
            let status = resp.status();
            let body_txt = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(format!("STT API error ({status}): {body_txt}"));
            }
            let json: serde_json::Value = serde_json::from_str(&body_txt)
                .map_err(|_| "รูปแบบผลลัพธ์จาก STT API ไม่ถูกต้อง".to_string())?;
            Ok(json["text"].as_str().unwrap_or("").trim().to_string())
        }
    }
}

#[cfg(target_os = "windows")]
mod win_audio {
    use super::{mix_and_resample_to_16khz, normalize_voice_position, VOICE_OV_HEIGHT, VOICE_OV_MARGIN, VOICE_OV_WIDTH};
    use std::mem::size_of;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use tauri::WebviewWindow;
    use windows::core::{implement, Interface, GUID, HRESULT};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::Media::Audio::{
        ActivateAudioInterfaceAsync, eCapture, eConsole, eRender,
        IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
        IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient,
        IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
        AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    };
    use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, BLOB};
    use windows::Win32::System::Variant::VT_BLOB;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetSystemMetrics, GetWindowLongPtrW, IsWindow, SetForegroundWindow,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SM_CXSCREEN,
        SM_CYSCREEN, SWP_SHOWWINDOW, SW_HIDE, WS_EX_TOOLWINDOW,
    };

    const VK_SHIFT: i32 = 0x10;
    const VK_CONTROL: i32 = 0x11;
    const VK_MENU: i32 = 0x12;

    const WAVE_FORMAT_PCM_TAG: u16 = 1;
    const WAVE_FORMAT_IEEE_FLOAT_TAG: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xFFFE;
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
        GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vKey: i32) -> i16;
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
        let phys_w = (VOICE_OV_WIDTH * scale).round() as i32;
        let phys_h = (VOICE_OV_HEIGHT * scale).round() as i32;
        let margin = (VOICE_OV_MARGIN as f64 * scale).round() as i32;
        let (left, top, right, bottom) = active_work_area();

        let (x, y) = match normalize_voice_position(position).as_str() {
            "top-left" => (left + margin, top + margin),
            "top-right" => (right - phys_w - margin, top + margin),
            "bottom-right" => (right - phys_w - margin, bottom - phys_h - margin),
            _ => (left + margin, bottom - phys_h - margin),
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

    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct ActivationHandler {
        done: Arc<(Mutex<bool>, Condvar)>,
    }

    impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
        fn ActivateCompleted(
            &self,
            _operation: windows::core::Ref<'_, IActivateAudioInterfaceAsyncOperation>,
        ) -> windows::core::Result<()> {
            let (lock, cvar) = &*self.done;
            if let Ok(mut guard) = lock.lock() {
                *guard = true;
                cvar.notify_all();
            }
            Ok(())
        }
    }

    struct ComGuard;
    impl ComGuard {
        fn init() -> Self {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            Self
        }
    }
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    #[derive(Clone, Copy)]
    struct AudioFormatDesc {
        channels: u16,
        sample_rate: u32,
        bits_per_sample: u16,
        is_float: bool,
    }

    unsafe fn parse_wave_format(fmt_ptr: *const WAVEFORMATEX) -> AudioFormatDesc {
        let fmt = &*fmt_ptr;
        let is_float = if fmt.wFormatTag == WAVE_FORMAT_IEEE_FLOAT_TAG {
            true
        } else if fmt.wFormatTag == WAVE_FORMAT_PCM_TAG {
            false
        } else if fmt.wFormatTag == WAVE_FORMAT_EXTENSIBLE_TAG {
            let ext = &*(fmt_ptr as *const WAVEFORMATEXTENSIBLE);
            let sub = std::ptr::addr_of!(ext.SubFormat).read_unaligned();
            sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
        } else {
            false
        };
        AudioFormatDesc {
            channels: fmt.nChannels.max(1),
            sample_rate: fmt.nSamplesPerSec.max(8000),
            bits_per_sample: fmt.wBitsPerSample.max(8),
            is_float,
        }
    }

    fn try_activate_process_loopback(pid: u32) -> Result<(IAudioClient, AudioFormatDesc), String> {
        let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                },
            },
        };
        let mut prop = std::mem::ManuallyDrop::new(PROPVARIANT::default());
        prop.Anonymous.Anonymous = std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
            vt: VT_BLOB,
            wReserved1: 0,
            wReserved2: 0,
            wReserved3: 0,
            Anonymous: PROPVARIANT_0_0_0 {
                blob: BLOB {
                    cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                    pBlobData: (&mut params as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast(),
                },
            },
        });

        let done = Arc::new((Mutex::new(false), Condvar::new()));
        let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler {
            done: Arc::clone(&done),
        }
        .into();

        let op = unsafe {
            ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                &IAudioClient::IID,
                Some(&*prop),
                &handler,
            )
        }
        .map_err(|e| format!("Process Loopback ไม่พร้อมใช้งาน: {e}"))?;

        let (lock, cvar) = &*done;
        let guard = lock.lock().map_err(|_| "lock failed".to_string())?;
        let (guard, timeout) = cvar
            .wait_timeout_while(guard, std::time::Duration::from_secs(2), |done| !*done)
            .map_err(|_| "wait failed".to_string())?;
        drop(guard);
        if timeout.timed_out() {
            return Err("Process Loopback timeout".into());
        }

        let mut hr = HRESULT(0);
        let mut unk = None;
        unsafe { op.GetActivateResult(&mut hr, &mut unk) }
            .map_err(|e| format!("Process Loopback activate failed: {e}"))?;
        if hr.is_err() {
            return Err(format!("Process Loopback HRESULT error: {hr:?}"));
        }
        let client: IAudioClient = unk
            .ok_or_else(|| "Process Loopback returned null".to_string())?
            .cast()
            .map_err(|e| format!("Cast IAudioClient failed: {e}"))?;

        let fmt_desc = AudioFormatDesc {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 32,
            is_float: true,
        };
        let mut wfx = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT_TAG,
            nChannels: fmt_desc.channels,
            nSamplesPerSec: fmt_desc.sample_rate,
            nAvgBytesPerSec: fmt_desc.sample_rate * 8,
            nBlockAlign: 8,
            wBitsPerSample: fmt_desc.bits_per_sample,
            cbSize: 0,
        };
        unsafe {
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    1_000_000,
                    0,
                    &mut wfx,
                    None,
                )
                .map_err(|e| format!("Initialize Process Loopback failed: {e}"))?;
        }
        Ok((client, fmt_desc))
    }

    fn init_endpoint_client(capture_mic: bool) -> Result<(IAudioClient, AudioFormatDesc), String> {
        let enumerator: IMMDeviceEnumerator =
            unsafe { windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|e| format!("เปิดระบบเสียง Windows ไม่สำเร็จ: {e}"))?;

        let data_flow = if capture_mic { eCapture } else { eRender };
        let device = unsafe { enumerator.GetDefaultAudioEndpoint(data_flow, eConsole) }
            .map_err(|e| format!("ไม่พบอุปกรณ์เสียงหลัก: {e}"))?;

        let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|e| format!("เชื่อมต่อ AudioClient ไม่สำเร็จ: {e}"))?;

        let fmt_ptr = unsafe { client.GetMixFormat() }
            .map_err(|e| format!("อ่านรูปแบบเสียงไม่สำเร็จ: {e}"))?;
        let fmt_desc = unsafe { parse_wave_format(fmt_ptr) };

        let flags = if capture_mic {
            0
        } else {
            AUDCLNT_STREAMFLAGS_LOOPBACK
        };
        let init_res = unsafe {
            client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 1_000_000, 0, fmt_ptr, None)
        };
        unsafe {
            CoTaskMemFree(Some(fmt_ptr.cast()));
        }
        init_res.map_err(|e| format!("เริ่มจับเสียงไม่สำเร็จ: {e}"))?;
        Ok((client, fmt_desc))
    }

    pub fn run_capture_loop<F>(
        mode: &str,
        fivem_pid: Option<u32>,
        stop_flag: &AtomicBool,
        mut on_samples: F,
    ) -> Result<String, String>
    where
        F: FnMut(&[i16]),
    {
        let _com = ComGuard::init();
        let (client, fmt_desc, label) = if mode == "mic" {
            let (c, f) = init_endpoint_client(true)?;
            (c, f, "ไมโครโฟนของเรา".to_string())
        } else if mode == "game" {
            if let Some(pid) = fivem_pid {
                match try_activate_process_loopback(pid) {
                    Ok((c, f)) => (c, f, format!("เฉพาะเกม FiveM (PID {pid})")),
                    Err(_) => {
                        let (c, f) = init_endpoint_client(false)?;
                        (c, f, "เสียงระบบ (Loopback Fallback)".to_string())
                    }
                }
            } else {
                let (c, f) = init_endpoint_client(false)?;
                (c, f, "เสียงระบบ (รอตรวจพบ FiveM)".to_string())
            }
        } else {
            let (c, f) = init_endpoint_client(false)?;
            (c, f, "เสียงระบบทั้งหมด (Loopback)".to_string())
        };

        let capture_client: IAudioCaptureClient = unsafe { client.GetService() }
            .map_err(|e| format!("เปิด AudioCaptureClient ไม่สำเร็จ: {e}"))?;
        unsafe { client.Start() }.map_err(|e| format!("สั่งเริ่มจับเสียงไม่สำเร็จ: {e}"))?;

        let frame_bytes = ((fmt_desc.channels as usize) * (fmt_desc.bits_per_sample as usize / 8)).max(1);

        while !stop_flag.load(Ordering::Relaxed) {
            let mut packet_len = unsafe { capture_client.GetNextPacketSize() }.unwrap_or(0);
            if packet_len == 0 {
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            while packet_len > 0 && !stop_flag.load(Ordering::Relaxed) {
                let mut data_ptr: *mut u8 = std::ptr::null_mut();
                let mut num_frames: u32 = 0;
                let mut flags: u32 = 0;
                if unsafe {
                    capture_client.GetBuffer(
                        &mut data_ptr,
                        &mut num_frames,
                        &mut flags,
                        None,
                        None,
                    )
                }
                .is_err()
                {
                    break;
                }

                if num_frames > 0 && !data_ptr.is_null() {
                    const AUDCLNT_BUFFERFLAGS_SILENT: u32 = 0x2;
                    if (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 {
                        let silence_len = ((num_frames as usize) * 16_000 / fmt_desc.sample_rate as usize).max(1);
                        let zeros = vec![0_i16; silence_len];
                        on_samples(&zeros);
                    } else {
                        let byte_len = (num_frames as usize) * frame_bytes;
                        let slice = unsafe { std::slice::from_raw_parts(data_ptr, byte_len) };
                        let resampled = mix_and_resample_to_16khz(
                            slice,
                            fmt_desc.channels,
                            fmt_desc.sample_rate,
                            fmt_desc.bits_per_sample,
                            fmt_desc.is_float,
                        );
                        if !resampled.is_empty() {
                            on_samples(&resampled);
                        }
                    }
                }
                let _ = unsafe { capture_client.ReleaseBuffer(num_frames) };
                packet_len = unsafe { capture_client.GetNextPacketSize() }.unwrap_or(0);
            }
        }

        let _ = unsafe { client.Stop() };
        Ok(label)
    }
}

#[cfg(not(target_os = "windows"))]
mod win_audio {
    use std::sync::atomic::AtomicBool;
    use tauri::WebviewWindow;

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
    pub fn run_capture_loop<F>(
        _mode: &str,
        _fivem_pid: Option<u32>,
        _stop_flag: &AtomicBool,
        _on_samples: F,
    ) -> Result<String, String>
    where
        F: FnMut(&[i16]),
    {
        Err("WASAPI audio capture รองรับบน Windows เท่านั้น".into())
    }
}

fn ensure_voice_overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(VOICE_OVERLAY_LABEL) {
        return Ok(existing);
    }

    let win = WebviewWindowBuilder::new(
        app,
        VOICE_OVERLAY_LABEL,
        WebviewUrl::App("index.html?window=voice-note".into()),
    )
    .title("Estra Voice To Note Overlay")
    .inner_size(VOICE_OV_WIDTH, VOICE_OV_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(true)
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|e| format!("สร้างหน้าต่าง Voice To Note Overlay ไม่สำเร็จ: {e}"))?;

    crate::security::lock_webview_window(&win);
    Ok(win)
}

fn show_voice_overlay_internal(
    app: &AppHandle,
    manager: &VoiceNoteManager,
    position: &str,
) -> Result<(), String> {
    let fg = win_audio::current_foreground_hwnd();
    let own_hwnd = app
        .get_webview_window(VOICE_OVERLAY_LABEL)
        .and_then(|w| w.hwnd().ok().map(|h| h.0 as isize))
        .unwrap_or(0);
    if fg != 0 && fg != own_hwnd {
        manager.prev_fg_hwnd.store(fg, Ordering::SeqCst);
    }

    let app_ui = app.clone();
    let pos = position.to_string();
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    let _ = app.run_on_main_thread(move || {
        let res = ensure_voice_overlay_window(&app_ui).map(|win| {
            win_audio::show_interactive_topmost(&win, &pos);
        });
        let _ = tx.send(res);
    });
    rx.recv_timeout(Duration::from_millis(1500))
        .map_err(|_| "ไม่สามารถเปิดหน้าต่าง Voice To Note ได้ทันเวลา".to_string())?
}

fn hide_voice_overlay_internal(
    app: &AppHandle,
    manager: &VoiceNoteManager,
    restore_prev_focus: bool,
) {
    let prev = manager.prev_fg_hwnd.swap(0, Ordering::SeqCst);
    let app_ui = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_ui.get_webview_window(VOICE_OVERLAY_LABEL) {
            win_audio::hide_overlay(&win);
        }
        if restore_prev_focus && prev != 0 {
            win_audio::restore_foreground_hwnd(prev);
        }
    });
}

fn start_voice_hotkey_worker(app: AppHandle, manager: VoiceNoteManager) {
    let _ = std::thread::Builder::new()
        .name("estra-voice-hotkey".into())
        .spawn(move || {
            crate::security::hide_sensitive_thread();
            let mut was_down = false;
            let mut last_toggle = Instant::now() - Duration::from_secs(5);
            let mut last_hotkey = String::new();

            loop {
                if !manager.is_installed() {
                    break;
                }
                let cfg = manager.snapshot_config();
                if !cfg.enabled {
                    was_down = false;
                    std::thread::sleep(Duration::from_millis(200));
                    continue;
                }
                if let Ok((ctrl, alt, shift, vk, canon)) = parse_voice_hotkey(&cfg.toggle_overlay_hotkey) {
                    if canon != last_hotkey {
                        was_down = false;
                        last_hotkey = canon.to_string();
                    }
                    let is_down = win_audio::is_hotkey_pressed(ctrl, alt, shift, vk);
                    if is_down && !was_down && last_toggle.elapsed() >= Duration::from_millis(320) {
                        last_toggle = Instant::now();
                        let _ = manager.toggle_overlay(&app, None);
                    }
                    was_down = is_down;
                }
                std::thread::sleep(Duration::from_millis(30));
            }
            manager.hotkey_running.store(false, Ordering::SeqCst);
        });
}

fn spawn_single_capture_channel(
    app: AppHandle,
    manager: VoiceNoteManager,
    channel_mode: String,
    source_tag: String,
) {
    let _ = std::thread::Builder::new()
        .name(format!("estra-voice-cap-{source_tag}"))
        .spawn(move || {
            crate::security::hide_sensitive_thread();
            let fivem_pid = if channel_mode == "game" {
                get_fivem_sessions()
                    .ok()
                    .and_then(|pids| pids.into_iter().next())
            } else {
                None
            };

            let label = match (channel_mode.as_str(), fivem_pid) {
                ("mic", _) => "ไมโครโฟนของเรา".to_string(),
                ("game", Some(pid)) => format!("เฉพาะเกม FiveM (PID {pid})"),
                ("game", None) => "เสียงระบบ (รอตรวจพบ FiveM)".to_string(),
                _ => "เสียงระบบทั้งหมด (Loopback)".to_string(),
            };
            if let Ok(mut guard) = manager.active_capture_label.lock() {
                if guard.is_empty() {
                    *guard = label.clone();
                } else if !guard.contains(&label) {
                    *guard = format!("{} + {label}", *guard);
                }
            }
            manager.emit_state(&app);

            // 16kHz VAD buffering
            const FRAME_SAMPLES: usize = 1600; // 100ms @ 16kHz
            const PRE_ROLL_FRAMES: usize = 3; // 300ms pre-roll
            let mut ring: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES * 4);
            let mut speech_buf: Vec<i16> = Vec::new();
            let mut pre_roll: Vec<Vec<i16>> = Vec::new();
            let mut speaking = false;
            let mut silence_frames: usize = 0;
            let mut last_meter = Instant::now() - Duration::from_secs(1);

            let app_ref = &app;
            let mgr_ref = &manager;
            let src_ref = &source_tag;
            let active_label_str = manager
                .active_capture_label
                .lock()
                .map(|g| g.clone())
                .unwrap_or_else(|_| label.clone());

            let res = win_audio::run_capture_loop(
                &channel_mode,
                fivem_pid,
                &manager.stop_flag,
                |samples| {
                    ring.extend_from_slice(samples);
                    while ring.len() >= FRAME_SAMPLES {
                        let frame: Vec<i16> = ring.drain(0..FRAME_SAMPLES).collect();
                        let cfg = mgr_ref.snapshot_config();
                        let rms = compute_rms(&frame);
                        let is_voice = rms >= cfg.vad_sensitivity;
                        let max_samples = (cfg.max_chunk_seconds as usize) * 16_000;

                        if last_meter.elapsed() >= Duration::from_millis(120) {
                            last_meter = Instant::now();
                            let _ = app_ref.emit(
                                "estra://voice-note-meter",
                                VoiceMeterPayload {
                                    level: (rms * 6.0).min(1.0),
                                    speaking: speaking || is_voice,
                                    transcribing: false,
                                    active_capture_label: active_label_str.clone(),
                                },
                            );
                        }

                        if is_voice {
                            if !speaking {
                                speaking = true;
                                for prev_f in pre_roll.drain(..) {
                                    speech_buf.extend_from_slice(&prev_f);
                                }
                            }
                            silence_frames = 0;
                            speech_buf.extend_from_slice(&frame);
                        } else if speaking {
                            silence_frames += 1;
                            speech_buf.extend_from_slice(&frame);
                            // Flush after ~700ms silence
                            if silence_frames >= 7 {
                                speaking = false;
                                silence_frames = 0;
                                let chunk = std::mem::take(&mut speech_buf);
                                if chunk.len() >= 5_600 {
                                    dispatch_transcription_async(
                                        app_ref.clone(),
                                        mgr_ref.clone(),
                                        chunk,
                                        src_ref.clone(),
                                    );
                                }
                            }
                        } else {
                            pre_roll.push(frame);
                            if pre_roll.len() > PRE_ROLL_FRAMES {
                                pre_roll.remove(0);
                            }
                        }

                        if speaking && speech_buf.len() >= max_samples {
                            let chunk = std::mem::take(&mut speech_buf);
                            speaking = false;
                            silence_frames = 0;
                            dispatch_transcription_async(
                                app_ref.clone(),
                                mgr_ref.clone(),
                                chunk,
                                src_ref.clone(),
                            );
                        }
                    }
                },
            );

            if let Err(err) = res {
                let _ = app.emit("estra://voice-note-error", err);
                manager.stop_capture(&app);
            }
        });
}

fn dispatch_transcription_async(
    app: AppHandle,
    manager: VoiceNoteManager,
    pcm_samples: Vec<i16>,
    source_tag: String,
) {
    let cfg = manager.snapshot_config();
    let wav = encode_pcm16_wav_16k(&pcm_samples);
    tauri::async_runtime::spawn(async move {
        let _ = app.emit(
            "estra://voice-note-meter",
            VoiceMeterPayload {
                level: 0.25,
                speaking: false,
                transcribing: true,
                active_capture_label: manager
                    .active_capture_label
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_default(),
            },
        );
        match transcribe_wav_chunk(&app, &cfg, wav).await {
            Ok(raw) => {
                if !is_whisper_silence_artifact(&raw) {
                    let fixed = if cfg.auto_apply_corrections {
                        apply_text_corrections(&raw, &cfg.corrections)
                    } else {
                        raw.clone()
                    };
                    let created_at = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let entry = VoiceNoteEntry {
                        id: format!("note-{}", uuid::Uuid::new_v4()),
                        text: fixed,
                        raw_text: raw,
                        source: source_tag,
                        created_at,
                        pinned: false,
                    };
                    manager.append_note_entry(&app, entry);
                }
            }
            Err(err) => {
                let _ = app.emit("estra://voice-note-error", err);
            }
        }
    });
}

fn spawn_audio_capture_worker(app: AppHandle, manager: VoiceNoteManager) {
    let cfg = manager.snapshot_config();
    match cfg.audio_source.as_str() {
        "both" => {
            spawn_single_capture_channel(app.clone(), manager.clone(), "game".into(), "game".into());
            spawn_single_capture_channel(app, manager, "mic".into(), "mic".into());
        }
        "mic" => {
            spawn_single_capture_channel(app, manager, "mic".into(), "mic".into());
        }
        "system" => {
            spawn_single_capture_channel(app, manager, "system".into(), "system".into());
        }
        _ => {
            spawn_single_capture_channel(app, manager, "game".into(), "game".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_persists_and_uninstalls_voice_addon() {
        let base = std::env::temp_dir().join(format!(
            "estra_voice_addon_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let dir = resolve_voice_addon_dir_from_base(&base).unwrap();
        let (installed, _, _) = load_voice_addon_from_dir(&dir).unwrap();
        assert!(!installed);

        let (man, cfg) = install_voice_addon_in_dir(&dir).unwrap();
        assert_eq!(man.id, VOICE_ADDON_ID);
        assert_eq!(cfg.audio_source, "game");
        assert_eq!(cfg.toggle_overlay_hotkey, "Alt+V");

        let (installed_now, loaded_man, loaded_cfg) = load_voice_addon_from_dir(&dir).unwrap();
        assert!(installed_now);
        assert_eq!(loaded_man.unwrap().version, VOICE_ADDON_VERSION);
        assert!(loaded_cfg.corrections.len() >= 3);

        uninstall_voice_addon_in_dir(&dir).unwrap();
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn resamples_stereo_float_and_encodes_valid_16k_wav() {
        // 48kHz stereo float32 -> 480 frames = 10ms -> should resample to ~160 samples at 16kHz
        let mut raw = Vec::with_capacity(480 * 8);
        for _ in 0..480 {
            raw.extend_from_slice(&0.5_f32.to_le_bytes());
            raw.extend_from_slice(&0.5_f32.to_le_bytes());
        }
        let mono16 = mix_and_resample_to_16khz(&raw, 2, 48_000, 32, true);
        assert_eq!(mono16.len(), 160);
        assert!((mono16[0] - 16384).abs() <= 2);

        let rms = compute_rms(&mono16);
        assert!(rms > 0.49 && rms < 0.51);

        let wav = encode_pcm16_wav_16k(&mono16);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + 160 * 2);
    }

    #[test]
    fn applies_learned_corrections_longest_first() {
        let pairs = vec![
            VoiceCorrectionPair {
                wrong: "โลเพ".into(),
                correct: "โรลเพลย์".into(),
            },
            VoiceCorrectionPair {
                wrong: "สะพานักเลียน".into(),
                correct: "สภานักเรียน".into(),
            },
        ];
        let fixed = apply_text_corrections("วันนี้ สะพานักเลียน ประชุมเรื่อง โลเพ", &pairs);
        assert_eq!(fixed, "วันนี้ สภานักเรียน ประชุมเรื่อง โรลเพลย์");
    }
}
