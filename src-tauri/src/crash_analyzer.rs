use crate::file_safety::{assert_no_links, assert_within, normalize_win_path};
use crate::fivem::resolve_installation;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

const MAX_LOG_TAIL_BYTES: u64 = 256 * 1024;
const MAX_SCAN_FILES: usize = 300;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrashServerContext {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub game_build: String,
    #[serde(default)]
    pub lock_pure: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashFixAction {
    pub id: String,
    pub label: String,
    pub description: String,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashFileRef {
    pub name: String,
    pub modified_at_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashAnalysisReport {
    pub has_crash: bool,
    pub is_recent_session_crash: bool,
    pub severity: String, // "critical" | "warning" | "info" | "clean"
    pub code: String,
    pub title: String,
    pub summary: String,
    pub fixes: Vec<CrashFixAction>,
    pub evidence_lines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_crash_file: Option<CrashFileRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_log_file: Option<CrashFileRef>,
    pub discord_ticket_text: String,
    pub analyzed_at_ms: u64,
}

struct FileCandidate {
    path: PathBuf,
    name: String,
    modified_at_ms: u64,
    size_bytes: u64,
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_symlink_or_reparse(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if (meta.file_attributes() & 0x0400) != 0 {
            return true;
        }
    }
    false
}

fn newest_file_matching<F>(dir: &Path, root_guard: &Path, predicate: F) -> Result<Option<FileCandidate>, String>
where
    F: Fn(&str) -> bool,
{
    if !dir.exists() {
        return Ok(None);
    }
    assert_within(root_guard, dir)?;
    assert_no_links(dir)?;

    let mut newest: Option<FileCandidate> = None;
    let mut scanned = 0usize;
    let entries = fs::read_dir(dir).map_err(|e| format!("อ่านโฟลเดอร์ไม่สำเร็จ: {e}"))?;
    for entry in entries.flatten() {
        scanned += 1;
        if scanned > MAX_SCAN_FILES {
            break;
        }
        let path = normalize_win_path(&entry.path());
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if is_symlink_or_reparse(&meta) || !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !predicate(&name) {
            continue;
        }
        let modified_at_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let size_bytes = meta.len();
        let replace = match &newest {
            None => true,
            Some(prev) => modified_at_ms > prev.modified_at_ms,
        };
        if replace {
            newest = Some(FileCandidate {
                path,
                name,
                modified_at_ms,
                size_bytes,
            });
        }
    }
    Ok(newest)
}

fn read_text_tail(path: &Path, max_bytes: u64) -> Result<String, String> {
    assert_no_links(path)?;
    let mut file = File::open(path).map_err(|e| format!("เปิดไฟล์ Log ไม่สำเร็จ: {e}"))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len > max_bytes {
        let _ = file.seek(SeekFrom::Start(len - max_bytes));
    }
    let mut buf = Vec::with_capacity(len.min(max_bytes) as usize);
    file.take(max_bytes)
        .read_to_end(&mut buf)
        .map_err(|e| format!("อ่านไฟล์ Log ไม่สำเร็จ: {e}"))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

pub fn sanitize_evidence_line(line: &str) -> String {
    static WIN_USER_RE: OnceLock<Regex> = OnceLock::new();
    static TOKEN_RE: OnceLock<Regex> = OnceLock::new();
    let user_re = WIN_USER_RE.get_or_init(|| {
        Regex::new(r"(?i)([A-Z]:\\Users\\)([^\\/\s]+)").unwrap()
    });
    let token_re = TOKEN_RE.get_or_init(|| {
        Regex::new(r"(?i)(token|authorization|bearer|ticket|cookie|password|secret)\s*[:=]\s*[^\s,;]+").unwrap()
    });
    let step1 = user_re.replace_all(line, "${1}<USER>");
    let step2 = token_re.replace_all(&step1, "$1=<REDACTED>");
    step2.trim().chars().take(240).collect()
}

struct DiagnosisRule {
    code: &'static str,
    severity: &'static str,
    title: &'static str,
    summary: &'static str,
    patterns: &'static [&'static str],
    fixes: &'static [(&'static str, &'static str, &'static str, bool)],
}

const RULES: &[DiagnosisRule] = &[
    DiagnosisRule {
        code: "ERR_GFX_D3D_INIT",
        severity: "critical",
        title: "การ์ดจอ / DirectX หรือ Shader Cache ขัดข้อง",
        summary: "FiveM หยุดทำงานจากปัญหา DirectX / GPU Driver (เช่น ERR_GFX_D3D_INIT, DXGI_ERROR_DEVICE_HUNG หรือ Shader เก่าค้าง)",
        patterns: &[
            "err_gfx_d3d_init",
            "dxgi_error_device_removed",
            "dxgi_error_device_hung",
            "dxgi_error_device_reset",
            "d3d11.dll",
            "nvwgf2umx.dll",
            "atidxx64.dll",
            "amdxc64.dll",
            "nvlddmkm",
            "err_gfx_state",
        ],
        fixes: &[
            ("clean_shaders", "ล้าง Shader / GPU Cache", "ลบแคช Shader และ GPUCache ที่เสียหายแล้วให้เกมสร้างใหม่", true),
            ("switch_preset_clean", "สลับเป็น Clean Pure Mode", "ถอดม็อดภาพ/ReShade ชั่วคราวเพื่อลดโหลด DirectX", false),
            ("clean_cache", "ล้างแคชเมือง", "ล้าง server-cache เพื่อกันไฟล์โมเดล/เท็กซ์เจอร์เสีย", false),
        ],
    },
    DiagnosisRule {
        code: "PURE_MODE_VIOLATION",
        severity: "critical",
        title: "ไฟล์ม็อดไม่รองรับ Pure Mode ของเมือง",
        summary: "เซิร์ฟเวอร์บังคับ Pure Mode (ระดับ 1 หรือ 2) แต่ตรวจพบไฟล์ม็อดใน mods/ หรือ plugins/ ที่ถูกแก้ไข ทำให้เกมไม่ยอมให้เข้าหรือเด้งออก",
        patterns: &[
            "sv_purelevel",
            "pure mode",
            "modified game files",
            "untrusted file",
            "pure_1",
            "pure_2",
            "client is not running in pure mode",
            "could not verify game files",
        ],
        fixes: &[
            ("switch_preset_clean", "สลับเป็น Clean Pure Mode ทันที", "เก็บไฟล์ม็อดปัจจุบันเข้าคลังอย่างปลอดภัยและล้าง mods/ plugins/ ให้พร้อมเข้าเมือง Pure Mode", true),
            ("clean_cache", "ล้างแคชเมือง", "ล้างแคชเมืองเพื่อให้โหลดทรัพยากรใหม่สะอาด", false),
        ],
    },
    DiagnosisRule {
        code: "MEMORY_OR_VRAM_EXHAUSTED",
        severity: "critical",
        title: "RAM / VRAM ไม่พอ หรือ Pool Size เต็ม",
        summary: "เกมใช้หน่วยความจำหรือ VRAM การ์ดจอเกินขีดจำกัด มักเกิดจากม็อดภาพความละเอียดสูง (NVE/QuantV), แคชเมืองสะสมเยอะ หรือเปิดหลายโปรแกรมพร้อมกัน",
        patterns: &[
            "out of memory",
            "err_mem_embeddedalloc",
            "err_mem_poolalloc",
            "poolsize",
            "failed to allocate",
            "video memory",
            "vram",
            "e_outofmemory",
            "memory allocation failed",
        ],
        fixes: &[
            ("switch_preset_clean", "สลับเป็น Clean Pure Mode / ลดม็อดภาพ", "ถอดม็อดภาพกิน VRAM ออกชั่วคราวเพื่อลดอาการเด้ง", true),
            ("clean_cache", "ล้างแคชเมือง", "ล้างแคชทรัพยากรเมืองที่สะสมเกินจำเป็น", true),
            ("clean_shaders", "ล้าง Shader / GPU Cache", "รีเซ็ตแคชกราฟิกในเครื่อง", false),
        ],
    },
    DiagnosisRule {
        code: "OVERLAY_OR_RESHADE_CONFLICT",
        severity: "warning",
        title: "ปลั๊กอิน ReShade / ENB หรือ Overlay ภายนอกชนกับ FiveM",
        summary: "ตรวจพบ DLL จาก ReShade, ENB, RivaTuner (RTSS) หรือ Overwolf ขัดแย้งกับเอนจินแสดงผลของ FiveM",
        patterns: &[
            "reshade",
            "enbseries",
            "d3dcompiler",
            "rtsshooks",
            "rivatuner",
            "overwolf",
            "d3d10.dll",
            "dxgi.dll!",
        ],
        fixes: &[
            ("switch_preset_clean", "สลับเป็น Clean Pure Mode", "ถอดไฟล์ใน plugins/ และ mods/ ออกอย่างปลอดภัยเพื่อทดสอบ", true),
            ("clean_shaders", "ล้าง Shader / GPU Cache", "ล้างแคช GPU ที่อาจค้างจาก ReShade", false),
        ],
    },
    DiagnosisRule {
        code: "RESOURCE_OR_CACHE_CORRUPT",
        severity: "warning",
        title: "แคชเมืองหรือไฟล์สตรีมมิ่งเสียหาย",
        summary: "พบข้อผิดพลาดระหว่างโหลดทรัพยากร/Packfile ของเซิร์ฟเวอร์ (server-cache หรือไฟล์สตรีมมิ่งโหลดไม่สมบูรณ์)",
        patterns: &[
            "packfile",
            "err_fil_pack",
            "corrupt",
            "citizen-resources",
            "failed to load resource",
            "streaming request",
            "fiPackfile",
            "rage::fiDevice",
            "server-cache",
        ],
        fixes: &[
            ("clean_cache", "ล้างแคชเมืองทันที", "ลบ server-cache และ subprocess ให้ FiveM โหลดไฟล์เมืองใหม่สมบูรณ์", true),
            ("clean_shaders", "ล้าง Shader / GPU Cache", "ล้างแคชกราฟิกร่วมด้วยหากยังโหลดโมเดลไม่ขึ้น", false),
        ],
    },
    DiagnosisRule {
        code: "NETWORK_OR_HANDSHAKE_FAIL",
        severity: "warning",
        title: "การเชื่อมต่อเซิร์ฟเวอร์ขาดหาย / Timeout",
        summary: "FiveM ไม่สามารถเชื่อมต่อหรือรักษาสัญญาณกับเซิร์ฟเวอร์ได้ (CURL timeout, connection reset หรือเส้นทางเน็ตแกว่ง)",
        patterns: &[
            "curl error",
            "timed out",
            "connection reset",
            "handshake failed",
            "failed to connect to",
            "could not bind",
            "net_error",
            "disconnected by server",
        ],
        fixes: &[
            ("open_network_diag", "ทดสอบ Ping / Jitter และเส้นทาง", "ตรวจสอบค่า Ping, Jitter และ Packet Loss ไปยังเซิร์ฟเวอร์", true),
            ("clean_cache", "ล้างแคชเมือง", "ล้างแคชหากเพิ่งมีการอัปเดตแพตช์เมือง", false),
        ],
    },
    DiagnosisRule {
        code: "AUDIO_VOIP_CONFLICT",
        severity: "warning",
        title: "อุปกรณ์เสียงหรือระบบ Mumble VoIP ขัดข้อง",
        summary: "พบข้อผิดพลาดฝั่งอุปกรณ์เสียง Windows (WASAPI / XAudio2) หรือ Mumble VoIP ขณะเข้าเมือง",
        patterns: &[
            "xaudio2",
            "wasapi",
            "mumble",
            "voip",
            "audio device",
            "audclient",
        ],
        fixes: &[
            ("open_mic_test", "เปิดทดสอบไมโครโฟนและอุปกรณ์เสียง", "ตรวจสอบอุปกรณ์เสียงหลักและสิทธิ์ไมค์ใน Estra Launcher", true),
        ],
    },
    DiagnosisRule {
        code: "GAME_BUILD_MISMATCH",
        severity: "warning",
        title: "Game Build ไม่ตรงหรือไฟล์ฐาน GTA V ไม่สมบูรณ์",
        summary: "เวอร์ชัน Game Build หรือไฟล์หลักของ GTA V ไม่ตรงกับที่เซิร์ฟเวอร์ต้องการ",
        patterns: &[
            "game build",
            "dlc",
            "err_str_failure",
            "invalid game version",
            "gtav",
            "verify game files",
        ],
        fixes: &[
            ("clean_cache", "ล้างแคชเมือง", "ล้างแคชเพื่อให้ FiveM ซิงก์ Build ใหม่", true),
            ("clean_logs_crashes", "ล้าง Log & Crash เก่า", "ทำความสะอาดไฟล์ Log และ Crash เก่า", false),
        ],
    },
    DiagnosisRule {
        code: "ACCESS_VIOLATION_OR_EARLY_EXIT",
        severity: "critical",
        title: "เกิด Access Violation (0xC0000005) หรือ Early-Exit Trap",
        summary: "โปรเซส FiveM ถูกตัดการทำงานกะทันหัน มักเกิดจากแคชเมืองชน, ม็อดไม่เข้ากัน หรือปลั๊กอินในระบบรบกวน",
        patterns: &[
            "0xc0000005",
            "access violation",
            "early-exit trap",
            "fatal error",
            "unhandled exception",
            "legacy crash",
            "adhesive",
            "crash signature",
            "an error at",
        ],
        fixes: &[
            ("clean_cache", "ล้างแคชเมือง", "แก้ปัญหาสคริปต์/แคชเมืองชนกันได้บ่อยที่สุด", true),
            ("clean_shaders", "ล้าง Shader / GPU Cache", "ล้างแคชกราฟิกที่อาจทำให้เกมเด้ง", false),
            ("switch_preset_clean", "สลับเป็น Clean Pure Mode", "ทดสอบเข้าเมืองแบบไม่ลงม็อดเสริม", false),
        ],
    },
];

fn has_clean_exit_marker(log_tail: &str) -> bool {
    let tail_window: String = log_tail
        .lines()
        .rev()
        .take(25)
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();
    tail_window.contains("quit:")
        || tail_window.contains("normal exit")
        || tail_window.contains("requested quit")
        || tail_window.contains("shutting down")
        || tail_window.contains("game exited cleanly")
        || tail_window.contains("wm_close")
}

fn extract_evidence_lines(log_text: &str, matched_patterns: &[&str]) -> Vec<String> {
    let mut lines = Vec::new();
    let interesting_keywords = [
        "error",
        "fatal",
        "crash",
        "exception",
        "err_",
        "dxgi",
        "pure",
        "0xc000",
        "failed",
        "timeout",
        "memory",
        "vram",
        "trap",
    ];
    for line in log_text.lines().rev() {
        let lower = line.to_lowercase();
        let hit_pattern = matched_patterns.iter().any(|p| lower.contains(&p.to_lowercase()));
        let hit_generic = interesting_keywords.iter().any(|k| lower.contains(k));
        if hit_pattern || hit_generic {
            let clean = sanitize_evidence_line(line);
            if !clean.is_empty() && !lines.contains(&clean) {
                lines.push(clean);
                if lines.len() >= 10 {
                    break;
                }
            }
        }
    }
    lines.reverse();
    lines
}

fn build_discord_ticket_text(
    code: &str,
    title: &str,
    summary: &str,
    ctx: &CrashServerContext,
    latest_crash: Option<&CrashFileRef>,
    latest_log: Option<&CrashFileRef>,
    evidence: &[String],
) -> String {
    let mut out = String::new();
    out.push_str("**[Estra FiveM Launcher — รายงานวิเคราะห์เกมเด้ง]**\n");
    out.push_str(&format!("- **อาการ / รหัส:** `{code}` — {title}\n"));
    if !ctx.name.trim().is_empty() || !ctx.ip.trim().is_empty() {
        out.push_str(&format!(
            "- **เมือง:** {} ({})\n",
            if ctx.name.trim().is_empty() { "-" } else { ctx.name.trim() },
            if ctx.ip.trim().is_empty() { "-" } else { ctx.ip.trim() }
        ));
    }
    if !ctx.game_build.trim().is_empty() || ctx.lock_pure.is_some() {
        out.push_str(&format!(
            "- **Spec เมือง:** Build {} / Pure Mode {}\n",
            if ctx.game_build.trim().is_empty() { "-" } else { ctx.game_build.trim() },
            ctx.lock_pure.map(|p| p.to_string()).unwrap_or_else(|| "-".into())
        ));
    }
    out.push_str(&format!("- **สรุปเบื้องต้น:** {summary}\n"));
    if let Some(cf) = latest_crash {
        out.push_str(&format!(
            "- **ไฟล์ Crash ล่าสุด:** `{}` ({} KB)\n",
            cf.name,
            (cf.size_bytes / 1024).max(1)
        ));
    }
    if let Some(lf) = latest_log {
        out.push_str(&format!("- **ไฟล์ Log ล่าสุด:** `{}`\n", lf.name));
    }
    if !evidence.is_empty() {
        out.push_str("```text\n");
        for line in evidence.iter().take(8) {
            out.push_str(line);
            out.push('\n');
        }
        out.push_str("```");
    }
    out
}

pub fn analyze_logs_in_app_dir(
    app_dir: &Path,
    since_unix_ms: Option<u64>,
    server_ctx: Option<&CrashServerContext>,
) -> Result<CrashAnalysisReport, String> {
    assert_no_links(app_dir)?;
    let ctx = server_ctx.cloned().unwrap_or_default();
    let analyzed_at_ms = now_unix_ms();

    let crashes_dir = app_dir.join("crashes");
    let logs_dir = app_dir.join("logs");

    let latest_crash = newest_file_matching(&crashes_dir, app_dir, |name| {
        let lower = name.to_lowercase();
        lower.ends_with(".dmp")
            || lower.ends_with(".log")
            || lower.ends_with(".txt")
            || lower.ends_with(".json")
    })?;

    let latest_log = newest_file_matching(&logs_dir, app_dir, |name| {
        let lower = name.to_lowercase();
        lower.starts_with("citizenfx_log") && lower.ends_with(".log")
    })?;

    let crash_ref = latest_crash.as_ref().map(|c| CrashFileRef {
        name: c.name.clone(),
        modified_at_ms: c.modified_at_ms,
        size_bytes: c.size_bytes,
    });
    let log_ref = latest_log.as_ref().map(|c| CrashFileRef {
        name: c.name.clone(),
        modified_at_ms: c.modified_at_ms,
        size_bytes: c.size_bytes,
    });

    // Build combined searchable corpus from readable log tail + readable crash text file (if any).
    let mut combined_text = String::new();
    if let Some(lf) = &latest_log {
        if let Ok(tail) = read_text_tail(&lf.path, MAX_LOG_TAIL_BYTES) {
            combined_text.push_str(&tail);
            combined_text.push('\n');
        }
    }
    if let Some(cf) = &latest_crash {
        let lower = cf.name.to_lowercase();
        if lower.ends_with(".log") || lower.ends_with(".txt") || lower.ends_with(".json") {
            if let Ok(tail) = read_text_tail(&cf.path, 64 * 1024) {
                combined_text.push_str(&tail);
                combined_text.push('\n');
            }
        }
    }

    let threshold = since_unix_ms.map(|ms| ms.saturating_sub(3_000));
    let crash_file_is_recent = match (threshold, &latest_crash) {
        (Some(t), Some(cf)) => cf.modified_at_ms >= t,
        _ => false,
    };
    let log_file_is_recent = match (threshold, &latest_log) {
        (Some(t), Some(lf)) => lf.modified_at_ms >= t,
        _ => false,
    };

    let clean_exit = !combined_text.is_empty() && has_clean_exit_marker(&combined_text);
    let lower_corpus = combined_text.to_lowercase();

    // Match against rule knowledge base
    let mut matched_rule: Option<&DiagnosisRule> = None;
    for rule in RULES {
        if rule.patterns.iter().any(|pat| lower_corpus.contains(&pat.to_lowercase())) {
            matched_rule = Some(rule);
            break;
        }
    }

    if let Some(rule) = matched_rule {
        let is_recent = crash_file_is_recent || (log_file_is_recent && !clean_exit);
        let evidence = extract_evidence_lines(&combined_text, rule.patterns);
        let fixes = rule
            .fixes
            .iter()
            .map(|(id, label, desc, primary)| CrashFixAction {
                id: (*id).into(),
                label: (*label).into(),
                description: (*desc).into(),
                primary: *primary,
            })
            .collect();
        let discord_ticket_text = build_discord_ticket_text(
            rule.code,
            rule.title,
            rule.summary,
            &ctx,
            crash_ref.as_ref(),
            log_ref.as_ref(),
            &evidence,
        );
        return Ok(CrashAnalysisReport {
            has_crash: true,
            is_recent_session_crash: is_recent,
            severity: rule.severity.into(),
            code: rule.code.into(),
            title: rule.title.into(),
            summary: rule.summary.into(),
            fixes,
            evidence_lines: evidence,
            latest_crash_file: crash_ref,
            latest_log_file: log_ref,
            discord_ticket_text,
            analyzed_at_ms,
        });
    }

    if latest_crash.is_some() {
        let code = "CRASH_DUMP_DETECTED";
        let title = "พบไฟล์ Crash Dump ล่าสุดของ FiveM";
        let summary = "ตรวจพบไฟล์ Crash Dump จากการปิดตัวผิดปกติ แต่ข้อความ Log ไม่ตรงกับรหัส error มาตรฐาน แนะนำล้างแคชเมือง/Shader หรือคัดลอกรายงานส่งแอดมินเมือง";
        let evidence = extract_evidence_lines(&combined_text, &[]);
        let fixes = vec![
            CrashFixAction {
                id: "clean_cache".into(),
                label: "ล้างแคชเมือง".into(),
                description: "ลบ server-cache และ subprocess เพื่อเริ่มโหลดทรัพยากรใหม่".into(),
                primary: true,
            },
            CrashFixAction {
                id: "clean_shaders".into(),
                label: "ล้าง Shader / GPU Cache".into(),
                description: "รีเซ็ตแคชกราฟิกและ NUI GPU Cache".into(),
                primary: false,
            },
            CrashFixAction {
                id: "clean_logs_crashes".into(),
                label: "ล้างไฟล์ Crash เก่า".into(),
                description: "ลบไฟล์ Crash dump เดิมออกหลังเก็บรายงานแล้ว".into(),
                primary: false,
            },
        ];
        let discord_ticket_text = build_discord_ticket_text(
            code,
            title,
            summary,
            &ctx,
            crash_ref.as_ref(),
            log_ref.as_ref(),
            &evidence,
        );
        return Ok(CrashAnalysisReport {
            has_crash: true,
            is_recent_session_crash: crash_file_is_recent,
            severity: "warning".into(),
            code: code.into(),
            title: title.into(),
            summary: summary.into(),
            fixes,
            evidence_lines: evidence,
            latest_crash_file: crash_ref,
            latest_log_file: log_ref,
            discord_ticket_text,
            analyzed_at_ms,
        });
    }

    let summary = if latest_log.is_some() {
        "ตรวจสอบไฟล์ CitizenFX_log ล่าสุดแล้ว ไม่พบรหัสความผิดพลาดหรือไฟล์ Crash Dump"
    } else {
        "ยังไม่พบไฟล์ Log หรือ Crash Dump ในโฟลเดอร์ FiveM ของเครื่องนี้"
    };
    let discord_ticket_text = build_discord_ticket_text(
        "NO_CRASH_FOUND",
        "ไม่พบอาการเกมเด้ง",
        summary,
        &ctx,
        crash_ref.as_ref(),
        log_ref.as_ref(),
        &[],
    );
    Ok(CrashAnalysisReport {
        has_crash: false,
        is_recent_session_crash: false,
        severity: "clean".into(),
        code: "NO_CRASH_FOUND".into(),
        title: "ไม่พบ Crash ในไฟล์ล่าสุด".into(),
        summary: summary.into(),
        fixes: vec![],
        evidence_lines: vec![],
        latest_crash_file: crash_ref,
        latest_log_file: log_ref,
        discord_ticket_text,
        analyzed_at_ms,
    })
}

pub fn analyze_crash_logs(
    fivem_path: &str,
    since_unix_ms: Option<u64>,
    server_ctx: Option<CrashServerContext>,
) -> Result<CrashAnalysisReport, String> {
    let installation = resolve_installation(fivem_path)?;
    analyze_logs_in_app_dir(&installation.app, since_unix_ms, server_ctx.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_app_dir(tag: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("estra_crash_test_{tag}_{stamp}"));
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::create_dir_all(dir.join("crashes")).unwrap();
        dir
    }

    use std::time::SystemTime;

    #[test]
    fn detects_d3d_crash_and_sanitizes_user_path() {
        let dir = temp_app_dir("d3d");
        let log_path = dir.join("logs").join("CitizenFX_log_2026-11-19.log");
        fs::write(
            &log_path,
            "[ 1200] Loading C:\\Users\\SecretBoss\\AppData\\Local\\FiveM\n[ 4200] Fatal Error: ERR_GFX_D3D_INIT - DXGI_ERROR_DEVICE_HUNG token=abc12345\n",
        )
        .unwrap();

        let report = analyze_logs_in_app_dir(&dir, Some(0), None).unwrap();
        assert!(report.has_crash);
        assert!(report.is_recent_session_crash);
        assert_eq!(report.code, "ERR_GFX_D3D_INIT");
        assert!(report.fixes.iter().any(|f| f.id == "clean_shaders"));
        assert!(report.evidence_lines.iter().all(|l| !l.contains("SecretBoss") && !l.contains("abc12345")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_pure_mode_violation_and_recommends_clean_preset() {
        let dir = temp_app_dir("pure");
        let log_path = dir.join("logs").join("CitizenFX_log_2026-11-19.log");
        fs::write(
            &log_path,
            "[ 500] Server enforces sv_pureLevel 2: Modified game files detected in mods/\n",
        )
        .unwrap();

        let report = analyze_logs_in_app_dir(&dir, Some(0), None).unwrap();
        assert!(report.has_crash);
        assert_eq!(report.code, "PURE_MODE_VIOLATION");
        assert_eq!(report.fixes[0].id, "switch_preset_clean");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clean_exit_without_errors_reports_no_crash() {
        let dir = temp_app_dir("clean");
        let log_path = dir.join("logs").join("CitizenFX_log_2026-11-19.log");
        fs::write(
            &log_path,
            "[ 100] Connected\n[ 900] Quit: normal exit requested\n",
        )
        .unwrap();

        let report = analyze_logs_in_app_dir(&dir, Some(0), None).unwrap();
        assert!(!report.has_crash);
        assert!(!report.is_recent_session_crash);
        assert_eq!(report.code, "NO_CRASH_FOUND");

        let _ = fs::remove_dir_all(&dir);
    }
}
