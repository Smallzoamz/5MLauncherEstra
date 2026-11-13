use crate::file_safety::{assert_no_links, assert_tree_no_links, assert_within, normalize_win_path};
use crate::player_name::{apply_player_name, validate_player_name};
use crate::presence::{get_process_names, is_fivem_process};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const WINDOWS_SHELL_PS1: &str = include_str!("../../src/server/windowsShell.ps1");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetKind {
    Join,
    Direct,
}

#[derive(Debug, Clone)]
pub struct ParsedTarget {
    pub kind: TargetKind,
    pub code: Option<String>,
    pub address: String,
}

pub fn parse_target(value: &str) -> Result<ParsedTarget, String> {
    if value.len() > 253 {
        return Err("กรุณาระบุ IP:port, โดเมน หรือ cfx.re/join/code".into());
    }
    let input = value.trim();
    static JOIN_RE: OnceLock<Regex> = OnceLock::new();
    let join_re = JOIN_RE
        .get_or_init(|| Regex::new(r"(?i)^(?:https://)?cfx\.re/join/([a-z0-9]{4,16})/?$").unwrap());
    if let Some(caps) = join_re.captures(input) {
        let code = caps[1].to_lowercase();
        return Ok(ParsedTarget {
            kind: TargetKind::Join,
            code: Some(code.clone()),
            address: format!("cfx.re/join/{code}"),
        });
    }

    static DIRECT_RE: OnceLock<Regex> = OnceLock::new();
    let direct_re = DIRECT_RE.get_or_init(|| {
        Regex::new(r"(?i)^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$").unwrap()
    });
    let caps = direct_re
        .captures(input)
        .ok_or_else(|| "รูปแบบที่อยู่ไม่ถูกต้อง ใช้ IP:port หรือ cfx.re/join/code".to_string())?;
    let host = caps[1].to_lowercase();
    let port: u32 = match caps.get(2) {
        Some(m) => m
            .as_str()
            .parse::<u32>()
            .map_err(|_| "โดเมนหรือพอร์ตไม่ถูกต้อง".to_string())?,
        None => 30120,
    };
    if !(1..=65535).contains(&port)
        || host
            .split('.')
            .any(|p| p.is_empty() || p.len() > 63 || p.starts_with('-') || p.ends_with('-'))
    {
        return Err("โดเมนหรือพอร์ตไม่ถูกต้อง".into());
    }
    if host.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        let parts: Vec<&str> = host.split('.').collect();
        if parts.len() != 4
            || parts.iter().any(|p| {
                p.parse::<u32>().map(|n| n > 255).unwrap_or(true)
                    || (p.len() > 1 && p.starts_with('0'))
            })
        {
            return Err("IPv4 ไม่ถูกต้อง".into());
        }
    }
    Ok(ParsedTarget {
        kind: TargetKind::Direct,
        code: None,
        address: format!("{host}:{port}"),
    })
}

pub fn banner_image_url(value: Option<&str>) -> Option<String> {
    let raw = value?;
    if raw.len() > 2048 || raw.bytes().any(|b| b < 0x20) {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.to_string())
}

pub fn server_icon_data_url(value: Option<&str>) -> Option<String> {
    let raw = value?;
    if raw.len() > 350_000
        || !raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
    {
        return None;
    }
    let bytes = BASE64.decode(raw).ok()?;
    if bytes.len() < 24
        || bytes[..8] != [137, 80, 78, 71, 13, 10, 26, 10]
        || &bytes[12..16] != b"IHDR"
    {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0 || height == 0 || width > 1024 || height > 1024 {
        return None;
    }
    Some(format!("data:image/png;base64,{}", BASE64.encode(&bytes)))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(4500))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("สร้าง HTTP client ไม่สำเร็จ: {e}"))
}

async fn fetch_json_with_status(url: &str) -> Result<Value, (Option<u16>, bool, String)> {
    let client = http_client().map_err(|e| (None, false, e))?;
    let res = client
        .get(url)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| {
            let network_offline = e.is_timeout() || e.is_connect();
            (None, network_offline, e.to_string())
        })?;
    let status = res.status().as_u16();
    if !res.status().is_success() {
        return Err((Some(status), false, format!("HTTP {status}")));
    }
    let mut size = 0usize;
    let mut buf = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| (None, e.is_timeout(), e.to_string()))?;
        size += chunk.len();
        if size > 1024 * 1024 {
            return Err((None, false, "ข้อมูลเซิร์ฟเวอร์มีขนาดเกินกำหนด".into()));
        }
        buf.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&buf).map_err(|e| (None, false, e.to_string()))
}

struct CachedBanner {
    value: Option<String>,
    expires: Instant,
}

fn banner_cache() -> &'static Mutex<HashMap<String, CachedBanner>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedBanner>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn resolve_banner_url(value: Option<&str>) -> Option<String> {
    let safe = banner_image_url(value)?;
    let url = Url::parse(&safe).ok()?;
    static SHARE_RE: OnceLock<Regex> = OnceLock::new();
    let share_re =
        SHARE_RE.get_or_init(|| Regex::new(r"^/(?:[a-z]{2}/)?([A-Za-z0-9]{6,40})/?$").unwrap());
    if url.host_str() != Some("imgbob.net") || url.port().is_some() {
        return Some(safe);
    }
    let caps = share_re.captures(url.path())?;
    let page_url = format!("https://imgbob.net/en/{}", &caps[1]);

    if let Ok(guard) = banner_cache().lock() {
        if let Some(entry) = guard.get(&page_url) {
            if entry.expires > Instant::now() {
                return entry.value.clone();
            }
        }
    }

    let mut image_url = None;
    if let Ok(client) = http_client() {
        if let Ok(res) = client.get(&page_url).send().await {
            let is_html = res
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|ct| ct.contains("text/html"))
                .unwrap_or(false);
            if res.status().is_success() && is_html {
                let mut buf = Vec::new();
                let mut stream = res.bytes_stream();
                while let Some(Ok(chunk)) = stream.next().await {
                    if buf.len() + chunk.len() > 512 * 1024 {
                        buf.clear();
                        break;
                    }
                    buf.extend_from_slice(&chunk);
                }
                if !buf.is_empty() {
                    let html = String::from_utf8_lossy(&buf);
                    static META_RE: OnceLock<Regex> = OnceLock::new();
                    static CONTENT_RE: OnceLock<Regex> = OnceLock::new();
                    let meta_re = META_RE.get_or_init(|| {
                        Regex::new(r#"(?i)<meta\s+[^>]*property=["']og:image["'][^>]*>"#).unwrap()
                    });
                    let content_re = CONTENT_RE.get_or_init(|| {
                        Regex::new(r#"(?i)\bcontent=["']([^"']+)["']"#).unwrap()
                    });
                    if let Some(m) = meta_re.find(&html) {
                        if let Some(c) = content_re.captures(m.as_str()) {
                            let decoded = c[1].replace("&amp;", "&");
                            if let Some(cand) = banner_image_url(Some(&decoded)) {
                                if let Ok(img_u) = Url::parse(&cand) {
                                    if img_u.scheme() == "https"
                                        && img_u.host_str() == Some("imgbob.net")
                                        && img_u.path().starts_with("/ib/")
                                    {
                                        image_url = Some(cand);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut guard) = banner_cache().lock() {
        if guard.len() >= 64 {
            if let Some(first_key) = guard.keys().next().cloned() {
                guard.remove(&first_key);
            }
        }
        let ttl = if image_url.is_some() { 300 } else { 30 };
        guard.insert(
            page_url,
            CachedBanner {
                value: image_url.clone(),
                expires: Instant::now() + Duration::from_secs(ttl),
            },
        );
    }
    image_url
}

fn parse_count(val: Option<&Value>) -> Option<u64> {
    let v = val?;
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    if let Some(s) = v.as_str() {
        if !s.is_empty() {
            if let Ok(n) = s.parse::<u64>() {
                return Some(n);
            }
        }
    }
    None
}

fn iso_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveServerInfo {
    pub online: bool,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    pub clients: Option<u64>,
    pub max_clients: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    pub game_build: Option<String>,
    pub lock_pure: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirements_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connecting_banner_url: Option<String>,
    pub ping: Option<u64>,
    pub checked_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn query_live_server(input: &str, include_media: bool) -> Result<LiveServerInfo, String> {
    let target = parse_target(input)?;
    let start = Instant::now();

    let result: Result<LiveServerInfo, (Option<u16>, bool, String)> = async {
        let (dynamic, info, requirements_info) = if target.kind == TargetKind::Join {
            let code = target.code.as_deref().unwrap_or("");
            let url = format!("https://servers-frontend.fivem.net/api/servers/single/{code}");
            let response = fetch_json_with_status(&url).await?;
            let data = response
                .get("Data")
                .filter(|v| v.is_object())
                .cloned()
                .ok_or_else(|| {
                    (
                        None,
                        false,
                        "ไม่พบข้อมูล Cfx.re ของเซิร์ฟเวอร์นี้".to_string(),
                    )
                })?;
            if parse_count(data.get("clients")).is_none() {
                return Err((
                    None,
                    false,
                    "ไม่พบข้อมูล Cfx.re ของเซิร์ฟเวอร์นี้".into(),
                ));
            }
            let mut dyn_obj = data.clone();
            if let Some(obj) = dyn_obj.as_object_mut() {
                if let Some(max_c) = data.get("svMaxclients").cloned() {
                    obj.insert("sv_maxclients".into(), max_c);
                }
            }
            let mut info_val = data.clone();
            let mut req_info: Option<Value> = None;

            if let Some(endpoints) = data.get("connectEndPoints").and_then(|v| v.as_array()) {
                for ep in endpoints.iter().take(2) {
                    let Some(ep_str) = ep.as_str() else { continue };
                    let Ok(direct) = parse_target(ep_str) else { continue };
                    if direct.kind != TargetKind::Direct {
                        continue;
                    }
                    let info_url = format!("http://{}/info.json", direct.address);
                    if let Ok(details) = fetch_json_with_status(&info_url).await {
                        if !details.is_object() {
                            continue;
                        }
                        if req_info.is_none() {
                            req_info = Some(details.clone());
                        }
                        let existing_icon = info_val.get("icon").and_then(|v| v.as_str());
                        let detail_icon = details.get("icon").and_then(|v| v.as_str());
                        if server_icon_data_url(detail_icon).is_some() {
                            if let Some(obj) = info_val.as_object_mut() {
                                obj.insert("icon".into(), Value::String(detail_icon.unwrap().to_string()));
                            }
                        } else if existing_icon.is_some() {
                            // keep existing
                        }
                        let mut merged_vars = info_val
                            .get("vars")
                            .and_then(|v| v.as_object())
                            .cloned()
                            .unwrap_or_default();
                        let det_vars = details.get("vars").and_then(|v| v.as_object());
                        if banner_image_url(merged_vars.get("banner_detail").and_then(|v| v.as_str())).is_none() {
                            if let Some(v) = det_vars.and_then(|m| m.get("banner_detail")).cloned() {
                                merged_vars.insert("banner_detail".into(), v);
                            }
                        }
                        if banner_image_url(merged_vars.get("banner_connecting").and_then(|v| v.as_str())).is_none() {
                            if let Some(v) = det_vars.and_then(|m| m.get("banner_connecting")).cloned() {
                                merged_vars.insert("banner_connecting".into(), v);
                            }
                        }
                        if let Some(obj) = info_val.as_object_mut() {
                            obj.insert("vars".into(), Value::Object(merged_vars));
                        }
                        let has_icon = server_icon_data_url(info_val.get("icon").and_then(|v| v.as_str())).is_some();
                        let has_banner = banner_image_url(
                            info_val
                                .get("vars")
                                .and_then(|v| v.get("banner_detail"))
                                .and_then(|v| v.as_str()),
                        )
                        .is_some()
                            || banner_image_url(
                                info_val
                                    .get("vars")
                                    .and_then(|v| v.get("banner_connecting"))
                                    .and_then(|v| v.as_str()),
                            )
                            .is_some();
                        if !include_media || (has_icon && has_banner) {
                            break;
                        }
                    }
                }
            }
            (dyn_obj, info_val, req_info)
        } else {
            let dyn_url = format!("http://{}/dynamic.json", target.address);
            let info_url = format!("http://{}/info.json", target.address);
            let (dyn_res, info_res) =
                tokio::join!(fetch_json_with_status(&dyn_url), fetch_json_with_status(&info_url));
            let dyn_val = dyn_res?;
            if parse_count(dyn_val.get("clients")).is_none() {
                return Err((
                    None,
                    false,
                    "ปลายทางไม่ได้ส่งสถานะ FiveM ที่ถูกต้อง".into(),
                ));
            }
            let info_opt = info_res.ok().filter(|v| v.is_object());
            let req = info_opt.clone();
            let info_val = info_opt.unwrap_or_else(|| serde_json::json!({}));
            (dyn_val, info_val, req)
        };

        let vars = info
            .get("vars")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        let req_vars = requirements_info
            .as_ref()
            .unwrap_or(&info)
            .get("vars")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        static BUILD_RE: OnceLock<Regex> = OnceLock::new();
        static PURE_RE: OnceLock<Regex> = OnceLock::new();
        let build_re = BUILD_RE.get_or_init(|| Regex::new(r"^[1-9]\d{3,4}$").unwrap());
        let pure_re = PURE_RE.get_or_init(|| Regex::new(r"^[012]$").unwrap());

        let game_build = req_vars
            .get("sv_enforceGameBuild")
            .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_u64().map(|n| n.to_string())))
            .filter(|s| build_re.is_match(s));
        let lock_pure = req_vars
            .get("sv_pureLevel")
            .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_u64().map(|n| n.to_string())))
            .filter(|s| pure_re.is_match(s))
            .and_then(|s| s.parse::<u8>().ok());

        let (banner_url, connecting_banner_url) = if include_media {
            tokio::join!(
                resolve_banner_url(vars.get("banner_detail").and_then(|v| v.as_str())),
                resolve_banner_url(vars.get("banner_connecting").and_then(|v| v.as_str()))
            )
        } else {
            (None, None)
        };

        let logo = server_icon_data_url(info.get("icon").and_then(|v| v.as_str()));
        let hostname = dynamic
            .get("hostname")
            .and_then(|v| v.as_str())
            .or_else(|| vars.get("sv_projectName").and_then(|v| v.as_str()))
            .unwrap_or(&target.address)
            .chars()
            .take(200)
            .collect::<String>();

        Ok(LiveServerInfo {
            online: true,
            status: "Online".into(),
            ip: Some(target.address.clone()),
            clients: parse_count(dynamic.get("clients")),
            max_clients: parse_count(dynamic.get("sv_maxclients")),
            hostname: Some(hostname),
            game_build,
            lock_pure,
            requirements_source: requirements_info.map(|_| "Direct HTTP".to_string()),
            icon_source: logo.as_ref().map(|_| "server-icon-v1".to_string()),
            logo_url: logo,
            banner_url,
            connecting_banner_url,
            ping: Some(start.elapsed().as_millis() as u64),
            checked_at: iso_now(),
            source: Some(if target.kind == TargetKind::Join {
                "Cfx.re listing".into()
            } else {
                "Direct HTTP".into()
            }),
            error: None,
        })
    }
    .await;

    match result {
        Ok(info) => Ok(info),
        Err((status, network_offline, msg)) => {
            let offline = (target.kind == TargetKind::Join && status == Some(404)) || network_offline;
            Ok(LiveServerInfo {
                online: false,
                status: if offline { "Offline" } else { "Unknown" }.into(),
                ip: None,
                clients: None,
                max_clients: None,
                hostname: None,
                game_build: None,
                lock_pure: None,
                requirements_source: None,
                logo_url: None,
                icon_source: None,
                banner_url: None,
                connecting_banner_url: None,
                ping: None,
                checked_at: iso_now(),
                source: None,
                error: Some(format!(
                    "{}: {msg}",
                    if offline {
                        "Offline — เซิร์ฟเวอร์ไม่ตอบกลับจากเครื่องนี้"
                    } else {
                        "ตรวจสอบเซิร์ฟเวอร์ไม่ได้"
                    }
                )),
            })
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiveMInstallation {
    pub root: PathBuf,
    pub exe: PathBuf,
    pub app: PathBuf,
    pub data: PathBuf,
}

fn expand_env_vars(input: &str) -> String {
    static ENV_RE: OnceLock<Regex> = OnceLock::new();
    let re = ENV_RE.get_or_init(|| Regex::new(r"(?i)%([a-z_]+)%").unwrap());
    re.replace_all(input, |caps: &regex::Captures| {
        let name = caps[1].to_uppercase();
        std::env::var(&name).unwrap_or_else(|_| caps[0].to_string())
    })
    .into_owned()
}

pub fn resolve_installation(input: &str) -> Result<FiveMInstallation, String> {
    if input.len() > 1024 || input.bytes().any(|b| b < 0x20) {
        return Err("พาธ FiveM ไม่ถูกต้อง".into());
    }
    let expanded = expand_env_vars(input.trim());
    let selected = if expanded.is_empty() {
        let local = std::env::var("LOCALAPPDATA")
            .map_err(|_| "ไม่พบ LOCALAPPDATA กรุณาระบุพาธ FiveM".to_string())?;
        PathBuf::from(local).join("FiveM")
    } else {
        PathBuf::from(&expanded)
    };
    if !selected.is_absolute() {
        return Err("กรุณาระบุพาธแบบเต็มของ FiveM".into());
    }
    let base = selected
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let selected_root = if base == "fivem.exe" || base == "fivem.app" {
        selected
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(selected.clone())
    } else {
        selected
    };
    let canonical = fs::canonicalize(&selected_root).map_err(|_| {
        "ไม่พบ FiveM.exe กรุณาตรวจพาธในการตั้งค่า หรือติดตั้ง FiveM ก่อน".to_string()
    })?;
    let root = normalize_win_path(&canonical);
    let exe = root.join("FiveM.exe");
    if !fs::metadata(&exe).map(|m| m.is_file()).unwrap_or(false) {
        return Err("ไม่พบ FiveM.exe กรุณาตรวจพาธในการตั้งค่า หรือติดตั้ง FiveM ก่อน".into());
    }
    let app = root.join("FiveM.app");
    let data = app.join("data");
    Ok(FiveMInstallation {
        root,
        exe,
        app,
        data,
    })
}

pub fn build_launch_args(ip: &str, cl2: bool, game_build: &str, lock_pure: u8) -> Result<Vec<String>, String> {
    let target = parse_target(ip)?;
    static BUILD_RE: OnceLock<Regex> = OnceLock::new();
    let build_re = BUILD_RE.get_or_init(|| Regex::new(r"^[1-9]\d{3,4}$").unwrap());
    if !build_re.is_match(game_build) {
        return Err("ตรวจสอบ Game Build ปัจจุบันจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่".into());
    }
    if lock_pure > 2 {
        return Err("ตรวจสอบ Pure Mode ปัจจุบันจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่".into());
    }
    let mut args = Vec::new();
    if cl2 {
        args.push("-cl2".into());
    }
    args.push(format!("-b{game_build}"));
    args.push(format!("-pure_{lock_pure}"));
    args.push(format!("fivem://connect/{}", target.address));
    Ok(args)
}

fn launch_through_explorer(installation: &FiveMInstallation, args: &[String]) -> Result<(), String> {
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let ps_exe = PathBuf::from(sys_root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let payload = serde_json::json!({
        "exe": installation.exe.to_string_lossy(),
        "cwd": installation.root.to_string_lossy(),
        "args": args,
    })
    .to_string();
    let payload_b64 = BASE64.encode(payload.as_bytes());
    let utf16_units: Vec<u8> = WINDOWS_SHELL_PS1
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    let script_b64 = BASE64.encode(&utf16_units);

    let mut cmd = Command::new(ps_exe);
    cmd.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        &script_b64,
    ])
    .env("ESTRA_LAUNCH_PAYLOAD", payload_b64);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|_| {
        "Windows Explorer เปิด FiveM ไม่สำเร็จ กรุณาตรวจพาธ FiveM และลองเปิดใหม่".to_string()
    })?;
    if !output.status.success() {
        return Err(
            "Windows Explorer เปิด FiveM ไม่สำเร็จ กรุณาตรวจพาธ FiveM และลองเปิดใหม่".into(),
        );
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub ip: String,
    #[serde(default)]
    pub cl2: bool,
    #[serde(default)]
    pub fivem_path: String,
    #[serde(default)]
    pub in_game_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchServerSnapshot {
    pub game_build: String,
    pub lock_pure: u8,
    pub checked_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub success: bool,
    pub server_info: LaunchServerSnapshot,
    pub protocol_url: String,
    pub message: String,
}

pub async fn execute_real_launch(req: LaunchRequest) -> Result<LaunchResult, String> {
    let target = parse_target(&req.ip)?;
    let player_name = validate_player_name(Some(&req.in_game_name))?;
    if !cfg!(windows) {
        return Err("เปิดเกมได้บน Windows เท่านั้น".into());
    }
    let installation = resolve_installation(&req.fivem_path)?;

    let assert_allowed = || -> Result<(), String> {
        if req.cl2 && player_name.is_empty() {
            return Ok(());
        }
        let names = get_process_names()
            .map_err(|_| "ตรวจสอบสถานะ FiveM ไม่ได้ กรุณาลองใหม่ก่อนเริ่มเกม".to_string())?;
        if names.iter().any(|n| is_fivem_process(n)) {
            return Err(if !player_name.is_empty() {
                "ต้องปิด FiveM ทุกหน้าต่างก่อนใช้ Name ของเมืองนี้ หากเปิด CL2 ให้เว้นช่อง Name ว่างเพื่อใช้ชื่อปัจจุบัน".into()
            } else {
                "FiveM กำลังทำงานอยู่ กรุณาปิดเกมเดิม หรือเปิด CL2 เพื่อเริ่มเกมตัวที่สอง".into()
            });
        }
        Ok(())
    };

    assert_allowed()?;
    let server_info = query_live_server(&req.ip, false).await?;
    if !server_info.online || server_info.requirements_source.as_deref() != Some("Direct HTTP") {
        let suffix = server_info
            .error
            .as_ref()
            .map(|e| format!(": {e}"))
            .unwrap_or_default();
        return Err(format!(
            "ตรวจสอบ Game Build และ Pure Mode จากเซิร์ฟเวอร์ปัจจุบันไม่ได้ กรุณาลองใหม่{suffix}"
        ));
    }
    let build = server_info
        .game_build
        .clone()
        .ok_or_else(|| "ตรวจสอบ Game Build ปัจจุบันจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่".to_string())?;
    let pure = server_info
        .lock_pure
        .ok_or_else(|| "ตรวจสอบ Pure Mode ปัจจุบันจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่".to_string())?;

    let args = build_launch_args(&req.ip, req.cl2, &build, pure)?;
    assert_allowed()?;

    if !player_name.is_empty() {
        let app_dir = installation.app.clone();
        let data_dir = installation.data.clone();
        let name_clone = player_name.clone();
        tokio::task::spawn_blocking(move || apply_player_name(&app_dir, &data_dir, Some(&name_clone)))
            .await
            .map_err(|_| "บันทึก Name ไม่สำเร็จ".to_string())??;
    }

    let inst_clone = installation.clone();
    let args_clone = args.clone();
    tokio::task::spawn_blocking(move || launch_through_explorer(&inst_clone, &args_clone))
        .await
        .map_err(|_| "ส่งคำสั่งเปิด FiveM ไม่สำเร็จ".to_string())??;

    Ok(LaunchResult {
        success: true,
        server_info: LaunchServerSnapshot {
            game_build: build.clone(),
            lock_pure: pure,
            checked_at: server_info.checked_at,
        },
        protocol_url: format!("fivem://connect/{}", target.address),
        message: format!(
            "ส่งคำสั่งเปิด FiveM ด้วย Game Build {build} / Pure Mode {pure} แล้ว โปรดดูผลการเชื่อมต่อในเกม"
        ),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanCacheResult {
    pub success: bool,
    pub steps: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn execute_real_clean_cache(fivem_path: &str) -> Result<CleanCacheResult, String> {
    let installation = resolve_installation(fivem_path)?;
    let names = get_process_names()?;
    if names.iter().any(|n| is_fivem_process(n)) {
        return Err("กรุณาปิด FiveM ทุกหน้าต่างก่อนล้างแคช ระบบจะไม่บังคับปิดเกม".into());
    }
    assert_no_links(&installation.data)?;
    if !fs::metadata(&installation.data).map(|m| m.is_dir()).unwrap_or(false) {
        return Err("ไม่พบโฟลเดอร์ data ของ FiveM".into());
    }
    let names_list = [
        "server-cache",
        "server-cache-priv",
        "cache/subprocess",
    ];
    let mut targets: Vec<(&str, PathBuf, bool)> = Vec::new();
    for rel in names_list {
        let abs = installation.data.join(rel);
        assert_within(&installation.data, &abs)?;
        assert_no_links(&abs)?;
        let exists = fs::symlink_metadata(&abs).is_ok();
        if exists {
            assert_tree_no_links(&abs).map_err(|e| e.to_string())?;
        }
        targets.push((rel, abs, exists));
    }
    let mut steps = Vec::new();
    let mut errors = Vec::new();
    for (rel, abs, exists) in targets {
        if !exists {
            steps.push(format!("{rel}: ไม่มีแคช"));
            continue;
        }
        match fs::remove_dir_all(&abs) {
            Ok(()) => steps.push(format!("{rel}: ลบแล้ว")),
            Err(e) => errors.push(format!("{rel}: {e}")),
        }
    }
    Ok(CleanCacheResult {
        success: errors.is_empty(),
        steps,
        error: if errors.is_empty() {
            None
        } else {
            Some(errors.join("; "))
        },
    })
}
