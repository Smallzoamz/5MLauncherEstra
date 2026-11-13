use crate::file_safety::{assert_no_links, assert_within};
use crate::fivem::resolve_installation;
use crate::presence::{get_process_names, is_fivem_process};
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use url::Url;
use uuid::Uuid;

pub const DEFAULT_GITHUB_REPO: &str = "Smallzoamz/5MLauncherEstra";

pub fn validate_github_repo(repo: &str) -> Result<String, String> {
    let trimmed = repo.trim();
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$").unwrap());
    if !re.is_match(trimmed) || trimmed.contains("..") {
        return Err("รูปแบบ GitHub repository ต้องเป็น owner/repo".into());
    }
    Ok(trimmed.to_string())
}

pub fn validate_https_url(raw: &str, allow_local_http: bool) -> Result<Url, String> {
    if raw.len() > 2048 || raw.bytes().any(|b| b < 0x20) {
        return Err("URL ของแพตช์ไม่ถูกต้อง".into());
    }
    let url = Url::parse(raw.trim()).map_err(|_| "รูปแบบ URL ของแพตช์ไม่ถูกต้อง".to_string())?;
    let is_local_test = allow_local_http
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    if (url.scheme() != "https" && !is_local_test)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("URL ของแพตช์ต้องใช้ HTTPS เท่านั้น".into());
    }
    Ok(url)
}

pub fn validate_relative_patch_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim().replace('\\', "/");
    if trimmed.is_empty()
        || trimmed.len() > 300
        || trimmed.starts_with('/')
        || trimmed.contains(':')
        || trimmed
            .bytes()
            .any(|b| b < 0x20 || matches!(b, b'*' | b'?' | b'"' | b'<' | b'>' | b'|'))
    {
        return Err(format!("พาธไฟล์แพตช์ไม่ปลอดภัย: {raw}"));
    }
    let mut out = PathBuf::new();
    for seg in trimmed.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." || seg.ends_with('.') || seg.ends_with(' ')
        {
            return Err(format!("พาธไฟล์แพตช์ไม่ปลอดภัย: {raw}"));
        }
        out.push(seg);
    }
    Ok(out)
}

pub fn validate_sha256(raw: &str) -> Result<String, String> {
    let s = raw.trim().to_lowercase();
    if s.len() != 64 || !s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(format!("ค่า SHA-256 ไม่ถูกต้อง: {raw}"));
    }
    Ok(s)
}

fn sanitize_server_id(server_id: &str) -> Result<String, String> {
    let cleaned: String = server_id
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(64)
        .collect();
    if cleaned.is_empty() {
        return Err("รหัสเมืองไม่ถูกต้อง".into());
    }
    Ok(cleaned)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchManifestFile {
    pub path: String,
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchManifest {
    pub version: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    pub files: Vec<PatchManifestFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileState {
    pub path: String,
    pub sha256: String,
    pub expected_size: Option<u64>,
    pub local_size: Option<u64>,
    pub status: String, // "up_to_date" | "missing" | "outdated"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCheckResult {
    pub version: String,
    pub name: String,
    pub notes: String,
    pub published_at: Option<String>,
    pub target_dir: String,
    pub total_files: usize,
    pub up_to_date_files: usize,
    pub pending_files: usize,
    pub total_download_bytes: u64,
    pub files: Vec<PatchFileState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchProgressEvent {
    pub phase: String,
    pub current_file: Option<String>,
    pub completed_files: usize,
    pub total_files: usize,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyResult {
    pub success: bool,
    pub version: String,
    pub updated_files: usize,
    pub skipped_files: usize,
    pub downloaded_bytes: u64,
    pub target_dir: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherUpdateCheck {
    pub configured: bool,
    pub github_repo: String,
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterProgressEvent {
    pub phase: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: u8,
}

pub async fn check_launcher_update(
    app: &AppHandle,
    github_repo: Option<&str>,
) -> Result<LauncherUpdateCheck, String> {
    let current_version = app.package_info().version.to_string();
    let repo_raw = github_repo
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GITHUB_REPO);
    let repo = validate_github_repo(repo_raw)?;

    if repo.starts_with("OWNER/") {
        return Ok(LauncherUpdateCheck {
            configured: false,
            github_repo: repo,
            current_version,
            available: false,
            version: None,
            notes: None,
            date: None,
            message: "ยังไม่ได้ตั้งค่า GitHub Repository (owner/repo) สำหรับอัปเดตตัว Launcher".into(),
        });
    }

    let endpoint: Url = format!("https://github.com/{repo}/releases/latest/download/latest.json")
        .parse()
        .map_err(|_| "URL ของ GitHub Release ไม่ถูกต้อง".to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("ตั้งค่าตัวตรวจอัปเดตไม่สำเร็จ: {e}"))?
        .build()
        .map_err(|e| format!("เริ่มต้นตัวตรวจอัปเดตไม่สำเร็จ: {e}"))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(LauncherUpdateCheck {
            configured: true,
            github_repo: repo,
            current_version,
            available: true,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
            message: format!("พบ Launcher เวอร์ชันใหม่ v{}", update.version),
        }),
        Ok(None) => Ok(LauncherUpdateCheck {
            configured: true,
            github_repo: repo,
            current_version: current_version.clone(),
            available: false,
            version: Some(current_version),
            notes: None,
            date: None,
            message: "Estra Launcher เป็นเวอร์ชันล่าสุดแล้ว".into(),
        }),
        Err(e) => Err(format!("ตรวจสอบอัปเดตจาก GitHub ไม่สำเร็จ: {e}")),
    }
}

pub async fn install_launcher_update(
    app: &AppHandle,
    github_repo: Option<&str>,
) -> Result<String, String> {
    let repo_raw = github_repo
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GITHUB_REPO);
    let repo = validate_github_repo(repo_raw)?;
    if repo.starts_with("OWNER/") {
        return Err("ยังไม่ได้ตั้งค่า GitHub Repository (owner/repo) สำหรับอัปเดตตัว Launcher".into());
    }
    let endpoint: Url = format!("https://github.com/{repo}/releases/latest/download/latest.json")
        .parse()
        .map_err(|_| "URL ของ GitHub Release ไม่ถูกต้อง".to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("ตั้งค่าตัวอัปเดตไม่สำเร็จ: {e}"))?
        .build()
        .map_err(|e| format!("เริ่มต้นตัวอัปเดตไม่สำเร็จ: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("ตรวจสอบอัปเดตไม่สำเร็จ: {e}"))?
        .ok_or_else(|| "Estra Launcher เป็นเวอร์ชันล่าสุดอยู่แล้ว".to_string())?;

    let app_for_progress = app.clone();
    let app_for_finish = app.clone();
    let mut downloaded_total = 0u64;
    update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded_total += chunk_len as u64;
                let percent = match content_len {
                    Some(total) if total > 0 => {
                        ((downloaded_total as f64 / total as f64) * 100.0).min(100.0) as u8
                    }
                    _ => 0,
                };
                let _ = app_for_progress.emit(
                    "estra://updater-progress",
                    UpdaterProgressEvent {
                        phase: "downloading".into(),
                        downloaded: downloaded_total,
                        total: content_len,
                        percent,
                    },
                );
            },
            move || {
                let _ = app_for_finish.emit(
                    "estra://updater-progress",
                    UpdaterProgressEvent {
                        phase: "installing".into(),
                        downloaded: 0,
                        total: None,
                        percent: 100,
                    },
                );
            },
        )
        .await
        .map_err(|e| format!("ดาวน์โหลด/ติดตั้งอัปเดตไม่สำเร็จ: {e}"))?;

    Ok(format!("ติดตั้งเวอร์ชัน {} สำเร็จ กำลังรีสตาร์ทโปรแกรม", update.version))
}

fn patch_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Estra-FiveM-Launcher/2.0")
        .build()
        .map_err(|e| format!("สร้าง HTTP client ไม่สำเร็จ: {e}"))
}

pub async fn fetch_manifest(manifest_url: &str, allow_local_http: bool) -> Result<PatchManifest, String> {
    let url = validate_https_url(manifest_url, allow_local_http)?;
    let client = patch_http_client()?;
    let res = client
        .get(url)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("โหลดไฟล์ Patch Manifest ไม่สำเร็จ: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("โหลด Patch Manifest ไม่สำเร็จ (HTTP {})", res.status().as_u16()));
    }
    let mut bytes = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("อ่าน Patch Manifest ไม่สำเร็จ: {e}"))?;
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("ไฟล์ Patch Manifest มีขนาดใหญ่เกินกำหนด (4 MB)".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let manifest: PatchManifest =
        serde_json::from_slice(&bytes).map_err(|e| format!("รูปแบบ Patch Manifest ไม่ถูกต้อง: {e}"))?;
    if manifest.files.len() > 2000 {
        return Err("จำนวนไฟล์ใน Patch Manifest เกินขีดจำกัด (2000 ไฟล์)".into());
    }
    for f in &manifest.files {
        validate_relative_patch_path(&f.path)?;
        validate_https_url(&f.url, allow_local_http)?;
        validate_sha256(&f.sha256)?;
    }
    Ok(manifest)
}

fn sha256_file(path: &Path) -> Result<(String, u64), std::io::Error> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hex::encode(hasher.finalize()), total))
}

fn resolve_patch_root(fivem_path: &str, server_id: &str) -> Result<PathBuf, String> {
    let installation = resolve_installation(fivem_path)?;
    let safe_id = sanitize_server_id(server_id)?;
    let root = installation.app.join("estra-patches").join(safe_id);
    assert_within(&installation.app, &root)?;
    assert_no_links(&root)?;
    Ok(root)
}

pub fn inspect_manifest_against_dir(
    manifest: &PatchManifest,
    target_root: &Path,
) -> Result<PatchCheckResult, String> {
    assert_no_links(target_root)?;
    let mut states = Vec::with_capacity(manifest.files.len());
    let mut up_to_date = 0usize;
    let mut pending = 0usize;
    let mut download_bytes = 0u64;

    for file in &manifest.files {
        let rel = validate_relative_patch_path(&file.path)?;
        let expected_hash = validate_sha256(&file.sha256)?;
        let abs = target_root.join(&rel);
        assert_within(target_root, &abs)?;
        assert_no_links(&abs)?;

        let (status, local_size) = match fs::symlink_metadata(&abs) {
            Ok(meta) if meta.is_file() => match sha256_file(&abs) {
                Ok((actual_hash, sz))
                    if actual_hash == expected_hash
                        && file.size.map(|s| s == sz).unwrap_or(true) =>
                {
                    up_to_date += 1;
                    ("up_to_date".to_string(), Some(sz))
                }
                Ok((_, sz)) => {
                    pending += 1;
                    download_bytes += file.size.unwrap_or(0);
                    ("outdated".to_string(), Some(sz))
                }
                Err(_) => {
                    pending += 1;
                    download_bytes += file.size.unwrap_or(0);
                    ("outdated".to_string(), None)
                }
            },
            Ok(_) => return Err(format!("เป้าหมายไม่ใช่ไฟล์ปกติ: {}", file.path)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                pending += 1;
                download_bytes += file.size.unwrap_or(0);
                ("missing".to_string(), None)
            }
            Err(e) => return Err(format!("ตรวจสอบไฟล์แพตช์ไม่สำเร็จ: {e}")),
        };

        states.push(PatchFileState {
            path: file.path.clone(),
            sha256: expected_hash,
            expected_size: file.size,
            local_size,
            status,
        });
    }

    Ok(PatchCheckResult {
        version: manifest.version.clone(),
        name: manifest
            .name
            .clone()
            .unwrap_or_else(|| "Estra City Patch".into()),
        notes: manifest.notes.clone().unwrap_or_default(),
        published_at: manifest.published_at.clone(),
        target_dir: target_root.to_string_lossy().into_owned(),
        total_files: states.len(),
        up_to_date_files: up_to_date,
        pending_files: pending,
        total_download_bytes: download_bytes,
        files: states,
    })
}

pub async fn check_city_patch(
    manifest_url: &str,
    fivem_path: &str,
    server_id: &str,
) -> Result<PatchCheckResult, String> {
    let target_root = resolve_patch_root(fivem_path, server_id)?;
    let manifest = fetch_manifest(manifest_url, false).await?;
    inspect_manifest_against_dir(&manifest, &target_root)
}

#[derive(Clone, Default)]
pub struct PatchCancelFlag(pub Arc<AtomicBool>);

pub async fn apply_city_patch(
    app: &AppHandle,
    manifest_url: &str,
    fivem_path: &str,
    server_id: &str,
    cancel: PatchCancelFlag,
) -> Result<PatchApplyResult, String> {
    cancel.0.store(false, Ordering::SeqCst);
    let names = get_process_names()?;
    if names.iter().any(|n| is_fivem_process(n)) {
        return Err("กรุณาปิด FiveM ทุกหน้าต่างก่อนอัปเดตแพตช์".into());
    }
    let target_root = resolve_patch_root(fivem_path, server_id)?;
    let manifest = fetch_manifest(manifest_url, false).await?;
    let check = inspect_manifest_against_dir(&manifest, &target_root)?;

    let to_download: Vec<&PatchManifestFile> = manifest
        .files
        .iter()
        .zip(check.files.iter())
        .filter(|(_, state)| state.status != "up_to_date")
        .map(|(file, _)| file)
        .collect();

    if to_download.is_empty() {
        return Ok(PatchApplyResult {
            success: true,
            version: manifest.version,
            updated_files: 0,
            skipped_files: check.up_to_date_files,
            downloaded_bytes: 0,
            target_dir: check.target_dir,
            message: "ไฟล์แพตช์ทั้งหมดเป็นเวอร์ชันล่าสุดแล้ว".into(),
        });
    }

    fs::create_dir_all(&target_root)
        .map_err(|e| format!("สร้างโฟลเดอร์แพตช์ไม่สำเร็จ: {e}"))?;

    let client = patch_http_client()?;
    let total_files = to_download.len();
    let total_bytes: u64 = to_download.iter().filter_map(|f| f.size).sum();
    let mut downloaded_bytes = 0u64;
    let mut updated_files = 0usize;

    for (idx, file) in to_download.iter().enumerate() {
        if cancel.0.load(Ordering::SeqCst) {
            return Err("ยกเลิกการดาวน์โหลดแพตช์แล้ว".into());
        }
        let rel = validate_relative_patch_path(&file.path)?;
        let expected_hash = validate_sha256(&file.sha256)?;
        let url = validate_https_url(&file.url, false)?;
        let dest = target_root.join(&rel);
        assert_within(&target_root, &dest)?;
        assert_no_links(&dest)?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("สร้างโฟลเดอร์ย่อยไม่สำเร็จ: {e}"))?;
        }

        let part_path = dest.with_extension(format!("part.{}", Uuid::new_v4()));
        let res = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("ดาวน์โหลด {} ไม่สำเร็จ: {e}", file.path))?;
        if !res.status().is_success() {
            return Err(format!(
                "ดาวน์โหลด {} ไม่สำเร็จ (HTTP {})",
                file.path,
                res.status().as_u16()
            ));
        }

        let mut part_file = fs::File::create(&part_path)
            .map_err(|e| format!("สร้างไฟล์ชั่วคราวไม่สำเร็จ: {e}"))?;
        let mut hasher = Sha256::new();
        let mut file_bytes = 0u64;
        let mut stream = res.bytes_stream();

        while let Some(chunk_res) = stream.next().await {
            if cancel.0.load(Ordering::SeqCst) {
                drop(part_file);
                let _ = fs::remove_file(&part_path);
                return Err("ยกเลิกการดาวน์โหลดแพตช์แล้ว".into());
            }
            let chunk = match chunk_res {
                Ok(c) => c,
                Err(e) => {
                    drop(part_file);
                    let _ = fs::remove_file(&part_path);
                    return Err(format!("ดาวน์โหลด {} ขัดข้อง: {e}", file.path));
                }
            };
            if let Err(e) = part_file.write_all(&chunk) {
                drop(part_file);
                let _ = fs::remove_file(&part_path);
                return Err(format!("เขียนไฟล์ {} ไม่สำเร็จ: {e}", file.path));
            }
            hasher.update(&chunk);
            file_bytes += chunk.len() as u64;
            downloaded_bytes += chunk.len() as u64;

            let percent = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).min(100.0) as u8
            } else {
                (((idx as f64 + 0.5) / total_files as f64) * 100.0).min(100.0) as u8
            };
            let _ = app.emit(
                "estra://patch-progress",
                PatchProgressEvent {
                    phase: "downloading".into(),
                    current_file: Some(file.path.clone()),
                    completed_files: idx,
                    total_files,
                    downloaded_bytes,
                    total_bytes,
                    percent,
                },
            );
        }
        drop(part_file);

        let actual_hash = hex::encode(hasher.finalize());
        if actual_hash != expected_hash || file.size.map(|s| s != file_bytes).unwrap_or(false) {
            let _ = fs::remove_file(&part_path);
            return Err(format!(
                "ตรวจสอบความถูกต้องไฟล์ {} ไม่ผ่าน (SHA-256 ไม่ตรงกับ Manifest)",
                file.path
            ));
        }

        if dest.exists() {
            let _ = fs::remove_file(&dest);
        }
        fs::rename(&part_path, &dest).map_err(|e| {
            let _ = fs::remove_file(&part_path);
            format!("ย้ายไฟล์ {} ไม่สำเร็จ: {e}", file.path)
        })?;
        updated_files += 1;

        let percent = (((idx + 1) as f64 / total_files as f64) * 100.0).min(100.0) as u8;
        let _ = app.emit(
            "estra://patch-progress",
            PatchProgressEvent {
                phase: "downloading".into(),
                current_file: Some(file.path.clone()),
                completed_files: idx + 1,
                total_files,
                downloaded_bytes,
                total_bytes,
                percent,
            },
        );
    }

    Ok(PatchApplyResult {
        success: true,
        version: manifest.version.clone(),
        updated_files,
        skipped_files: check.up_to_date_files,
        downloaded_bytes,
        target_dir: check.target_dir,
        message: format!(
            "อัปเดตแพตช์ v{} สำเร็จ ({} ไฟล์ใหม่/อัปเดต, ข้าม {} ไฟล์ที่ตรงกัน)",
            manifest.version, updated_files, check.up_to_date_files
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_patch_paths_urls_and_sha256() {
        assert!(validate_https_url("https://github.com/a/b/releases/latest/download/manifest.json", false).is_ok());
        assert!(validate_https_url("http://github.com/a.json", false).is_err());
        assert!(validate_https_url("https://user:pass@github.com/a.json", false).is_err());

        assert!(validate_relative_patch_path("citizen/common/data/visualsettings.dat").is_ok());
        assert!(validate_relative_patch_path("../FiveM.exe").is_err());
        assert!(validate_relative_patch_path("C:/Windows/win.ini").is_err());
        assert!(validate_relative_patch_path("/etc/passwd").is_err());

        assert!(validate_sha256(&"a".repeat(64)).is_ok());
        assert!(validate_sha256("not-a-hash").is_err());
    }

    #[test]
    fn inspects_missing_up_to_date_and_outdated_files() {
        let root = std::env::temp_dir().join(format!("estra-patch-test-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("sub")).unwrap();
        let content = b"hello estra patch";
        fs::write(root.join("sub").join("ok.txt"), content).unwrap();
        fs::write(root.join("sub").join("old.txt"), b"stale").unwrap();

        let hash_ok = hex::encode(Sha256::digest(content));
        let hash_new = hex::encode(Sha256::digest(b"updated"));
        let manifest = PatchManifest {
            version: "1.2.0".into(),
            name: Some("Test Patch".into()),
            notes: Some("Line 1".into()),
            published_at: None,
            files: vec![
                PatchManifestFile {
                    path: "sub/ok.txt".into(),
                    url: "https://example.com/ok.txt".into(),
                    sha256: hash_ok,
                    size: Some(content.len() as u64),
                },
                PatchManifestFile {
                    path: "sub/old.txt".into(),
                    url: "https://example.com/old.txt".into(),
                    sha256: hash_new.clone(),
                    size: Some(7),
                },
                PatchManifestFile {
                    path: "sub/missing.txt".into(),
                    url: "https://example.com/missing.txt".into(),
                    sha256: hash_new,
                    size: Some(7),
                },
            ],
        };

        let check = inspect_manifest_against_dir(&manifest, &root).unwrap();
        assert_eq!(check.up_to_date_files, 1);
        assert_eq!(check.pending_files, 2);
        assert_eq!(check.total_download_bytes, 14);
        assert_eq!(check.files[0].status, "up_to_date");
        assert_eq!(check.files[1].status, "outdated");
        assert_eq!(check.files[2].status, "missing");

        let _ = fs::remove_dir_all(&root);
    }
}
