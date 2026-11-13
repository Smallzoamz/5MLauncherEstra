use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const DISCORD_APPLICATION_ID: &str = "1545873345596096734";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUser {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub running: Option<bool>,
    pub user: Option<AccountUser>,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiveMStatus {
    pub running: Option<bool>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPresence {
    pub steam: ServiceStatus,
    pub discord: ServiceStatus,
    pub fivem: FiveMStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
}

pub fn is_fivem_process(name: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)^fivem(?:_.*)?\.exe$").unwrap());
    re.is_match(name)
}

pub fn is_fivem_session_process(name: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)^fivem(?:_b\d+)?(?:_GTAProcess|_GameProcess)?\.exe$").unwrap()
    });
    re.is_match(name)
}

fn run_tasklist() -> Result<String, String> {
    if !cfg!(windows) {
        return Err("การตรวจโปรแกรมรองรับ Windows เท่านั้น".into());
    }
    let mut cmd = Command::new("tasklist.exe");
    cmd.args(["/FO", "CSV", "/NH"]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .map_err(|_| "อ่านรายการ process ของ Windows ไม่ได้".to_string())?;
    if !output.status.success() {
        return Err("อ่านรายการ process ของ Windows ไม่ได้".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn get_process_names() -> Result<Vec<String>, String> {
    let stdout = run_tasklist()?;
    let mut names = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix('"') {
            if let Some(end) = rest.find('"') {
                let name = rest[..end].to_lowercase();
                if !name.is_empty() {
                    names.push(name);
                }
            }
        }
    }
    if names.is_empty() {
        return Err("อ่านรายการ process ของ Windows ไม่ได้".into());
    }
    Ok(names)
}

pub fn get_fivem_sessions() -> Result<Vec<u32>, String> {
    let stdout = run_tasklist()?;
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"^"([^"]+)","(\d+)""#).unwrap());
    let mut pids = Vec::new();
    let mut total_rows = 0usize;
    for line in stdout.lines() {
        if let Some(caps) = re.captures(line) {
            total_rows += 1;
            let name = &caps[1];
            if is_fivem_session_process(name) {
                if let Ok(pid) = caps[2].parse::<u32>() {
                    pids.push(pid);
                }
            }
        }
    }
    if total_rows == 0 {
        return Err("อ่านรายการ process ของ Windows ไม่ได้".into());
    }
    Ok(pids)
}

#[derive(Debug, Clone)]
pub enum VdfNode {
    Str(String),
    Obj(HashMap<String, VdfNode>),
}

pub fn parse_vdf(text: &str) -> Result<HashMap<String, VdfNode>, String> {
    if text.len() > 2 * 1024 * 1024 {
        return Err("Steam profile file too large".into());
    }
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE
        .get_or_init(|| Regex::new(r#""(?:\\.|[^"\\])*"|[{}]|//[^\r\n]*|[^\s{}"]+"#).unwrap());
    let tokens: Vec<&str> = re.find_iter(text).map(|m| m.as_str()).collect();
    let mut index = 0usize;

    fn unquote(token: &str) -> String {
        if token.starts_with('"') && token.ends_with('"') && token.len() >= 2 {
            token[1..token.len() - 1]
                .replace(r#"\""#, "\"")
                .replace(r"\\", "\\")
        } else {
            token.to_string()
        }
    }

    fn parse_obj(
        tokens: &[&str],
        index: &mut usize,
        depth: usize,
    ) -> Result<HashMap<String, VdfNode>, String> {
        if depth > 30 {
            return Err("Invalid Steam profile".into());
        }
        let mut map = HashMap::new();
        while *index < tokens.len() {
            let key = tokens[*index];
            *index += 1;
            if key.starts_with("//") {
                continue;
            }
            if key == "}" {
                return Ok(map);
            }
            if *index >= tokens.len() {
                return Err("Invalid Steam profile".into());
            }
            let val = tokens[*index];
            *index += 1;
            let node = if val == "{" {
                VdfNode::Obj(parse_obj(tokens, index, depth + 1)?)
            } else {
                VdfNode::Str(unquote(val))
            };
            map.insert(unquote(key), node);
        }
        Ok(map)
    }

    parse_obj(&tokens, &mut index, 0)
}

fn read_limited_file(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|_| "อ่านไฟล์โปรไฟล์ไม่ได้".to_string())?;
    let meta = file.metadata().map_err(|_| "อ่านข้อมูลไฟล์ไม่ได้".to_string())?;
    if meta.len() as usize > max {
        return Err("Profile file too large".into());
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    file.read_to_end(&mut buf)
        .map_err(|_| "อ่านไฟล์โปรไฟล์ไม่ได้".to_string())?;
    if buf.len() > max {
        return Err("Profile file too large".into());
    }
    Ok(buf)
}

fn read_steam_identity() -> Result<(PathBuf, String), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let steam_key = hkcu
        .open_subkey("Software\\Valve\\Steam")
        .map_err(|_| "Steam ยังไม่ได้ล็อกอินบัญชี".to_string())?;
    let steam_path: String = steam_key
        .get_value("SteamPath")
        .map_err(|_| "Steam ยังไม่ได้ล็อกอินบัญชี".to_string())?;
    let active_key = hkcu
        .open_subkey("Software\\Valve\\Steam\\ActiveProcess")
        .map_err(|_| "Steam ยังไม่ได้ล็อกอินบัญชี".to_string())?;
    let account_id: u32 = active_key
        .get_value("ActiveUser")
        .map_err(|_| "Steam ยังไม่ได้ล็อกอินบัญชี".to_string())?;
    let path = PathBuf::from(steam_path.trim());
    if !path.is_absolute() || account_id == 0 {
        return Err("Steam ยังไม่ได้ล็อกอินบัญชี".into());
    }
    let steam_id = (76561197960265728u64 + account_id as u64).to_string();
    Ok((path, steam_id))
}

pub fn get_steam_profile() -> Result<AccountUser, String> {
    let (steam_path, steam_id) = read_steam_identity()?;
    if !steam_id.starts_with("765") || steam_id.len() != 17 {
        return Err("อ่านบัญชี Steam ปัจจุบันไม่ได้".into());
    }
    let vdf_bytes = read_limited_file(&steam_path.join("config").join("loginusers.vdf"), 2 * 1024 * 1024)?;
    let vdf_text = String::from_utf8_lossy(&vdf_bytes);
    let parsed = parse_vdf(&vdf_text)?;
    let users = match parsed.get("users") {
        Some(VdfNode::Obj(m)) => m,
        _ => return Err("ไม่พบชื่อบัญชี Steam ที่ใช้งานอยู่".into()),
    };
    let user_obj = match users.get(&steam_id) {
        Some(VdfNode::Obj(m)) => m,
        _ => return Err("ไม่พบชื่อบัญชี Steam ที่ใช้งานอยู่".into()),
    };
    let display_name = match user_obj.get("PersonaName") {
        Some(VdfNode::Str(s)) if !s.trim().is_empty() => s.clone(),
        _ => return Err("ไม่พบชื่อบัญชี Steam ที่ใช้งานอยู่".into()),
    };

    let mut avatar_url = None;
    for ext in ["png", "jpg"] {
        let avatar_path = steam_path
            .join("config")
            .join("avatarcache")
            .join(format!("{steam_id}.{ext}"));
        if let Ok(bytes) = read_limited_file(&avatar_path, 1024 * 1024) {
            if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
                avatar_url = Some(format!("data:image/png;base64,{}", BASE64.encode(&bytes)));
                break;
            }
            if bytes.len() >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255 {
                avatar_url = Some(format!("data:image/jpeg;base64,{}", BASE64.encode(&bytes)));
                break;
            }
        }
    }

    // Re-check ActiveUser after IO to prevent returning a stale account during switch.
    if read_steam_identity()?.1 != steam_id {
        return Err("Steam กำลังเปลี่ยนบัญชี กรุณารอสักครู่".into());
    }

    Ok(AccountUser {
        id: steam_id,
        display_name: display_name.chars().take(100).collect(),
        username: None,
        avatar_url,
        source: "Steam ActiveUser".into(),
    })
}

pub fn discord_profile_from_json(user: &Value) -> Result<AccountUser, String> {
    let id = user
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| (17..=20).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(|| "Discord ยังไม่ได้ล็อกอินบัญชี".to_string())?;
    let username = user
        .get("username")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Discord ยังไม่ได้ล็อกอินบัญชี".to_string())?;
    let global_name = user.get("global_name").and_then(|v| v.as_str());
    let avatar = user.get("avatar").and_then(|v| v.as_str()).filter(|s| {
        let hex_part = s.strip_prefix("a_").unwrap_or(s);
        hex_part.len() == 32 && hex_part.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    });
    let discriminator = user.get("discriminator").and_then(|v| v.as_str()).unwrap_or("");
    let default_index = if discriminator.len() == 4
        && discriminator.bytes().all(|b| b.is_ascii_digit())
        && discriminator != "0000"
    {
        discriminator.parse::<u64>().unwrap_or(0) % 5
    } else {
        let id_num = id.parse::<u64>().unwrap_or(0);
        (id_num >> 22) % 6
    };

    let avatar_url = match avatar {
        Some(hash) => format!("https://cdn.discordapp.com/avatars/{id}/{hash}.png?size=128"),
        None => format!("https://cdn.discordapp.com/embed/avatars/{default_index}.png"),
    };

    let display = global_name.filter(|s| !s.is_empty()).unwrap_or(username);
    Ok(AccountUser {
        id: id.to_string(),
        display_name: display.chars().take(100).collect(),
        username: Some(username.chars().take(100).collect()),
        avatar_url: Some(avatar_url),
        source: "Discord RPC".into(),
    })
}

async fn read_discord_pipe(pipe_path: &str, timeout: Duration) -> Result<AccountUser, String> {
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ClientOptions;

        tokio::time::timeout(timeout, async {
            let mut client = ClientOptions::new()
                .open(pipe_path)
                .map_err(|_| "connect failed".to_string())?;
            let handshake = serde_json::json!({ "v": 1, "client_id": DISCORD_APPLICATION_ID }).to_string();
            let mut frame = Vec::with_capacity(8 + handshake.len());
            frame.extend_from_slice(&0u32.to_le_bytes());
            frame.extend_from_slice(&(handshake.len() as u32).to_le_bytes());
            frame.extend_from_slice(handshake.as_bytes());
            client
                .write_all(&frame)
                .await
                .map_err(|_| "write failed".to_string())?;

            let mut buf = Vec::new();
            let mut tmp = [0u8; 4096];
            loop {
                let n = client
                    .read(&mut tmp)
                    .await
                    .map_err(|_| "Discord disconnected".to_string())?;
                if n == 0 {
                    return Err("Discord disconnected".into());
                }
                buf.extend_from_slice(&tmp[..n]);
                if buf.len() > 262_144 {
                    return Err("Discord RPC frame too large".into());
                }
                while buf.len() >= 8 {
                    let opcode = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
                    let len = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize;
                    if len > 262_136 {
                        return Err("Discord RPC frame too large".into());
                    }
                    if buf.len() < 8 + len {
                        break;
                    }
                    let payload = buf[8..8 + len].to_vec();
                    buf.drain(..8 + len);
                    if opcode == 3 {
                        let mut pong = Vec::with_capacity(8 + payload.len());
                        pong.extend_from_slice(&4u32.to_le_bytes());
                        pong.extend_from_slice(&(payload.len() as u32).to_le_bytes());
                        pong.extend_from_slice(&payload);
                        let _ = client.write_all(&pong).await;
                        continue;
                    }
                    let msg: Value = serde_json::from_slice(&payload)
                        .map_err(|_| "ข้อมูลโปรไฟล์ Discord ไม่ถูกต้อง".to_string())?;
                    if opcode == 2 || msg.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
                        return Err("Discord ไม่อนุญาตการอ่านโปรไฟล์ผ่าน RPC".into());
                    }
                    if opcode == 1 && msg.get("evt").and_then(|v| v.as_str()) == Some("READY") {
                        let user = msg
                            .get("data")
                            .and_then(|d| d.get("user"))
                            .unwrap_or(&Value::Null);
                        return discord_profile_from_json(user);
                    }
                }
            }
        })
        .await
        .map_err(|_| "Discord RPC timed out".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (pipe_path, timeout);
        Err("Discord pipe supported on Windows only".into())
    }
}

pub async fn get_discord_profile() -> Result<AccountUser, String> {
    let deadline = Instant::now() + Duration::from_millis(2500);
    for i in 0..10 {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let remaining = (deadline - now).min(Duration::from_millis(1200));
        let pipe = format!(r"\\?\pipe\discord-ipc-{i}");
        if let Ok(user) = read_discord_pipe(&pipe, remaining).await {
            return Ok(user);
        }
    }
    Err("เปิด Discord แล้ว แต่ยังอ่านบัญชีผ่าน RPC ไม่ได้".into())
}

pub async fn get_system_presence() -> SystemPresence {
    let names = match tokio::task::spawn_blocking(get_process_names).await {
        Ok(Ok(n)) => n,
        Ok(Err(err)) => {
            return SystemPresence {
                steam: ServiceStatus {
                    running: None,
                    user: None,
                    error: Some(err.clone()),
                    profile_error: None,
                },
                discord: ServiceStatus {
                    running: None,
                    user: None,
                    error: Some(err.clone()),
                    profile_error: None,
                },
                fivem: FiveMStatus {
                    running: None,
                    error: Some(err),
                },
                checked_at: None,
            };
        }
        Err(_) => {
            let err = e_msg_or_default();
            return SystemPresence {
                steam: ServiceStatus {
                    running: None,
                    user: None,
                    error: Some(err.clone()),
                    profile_error: None,
                },
                discord: ServiceStatus {
                    running: None,
                    user: None,
                    error: Some(err.clone()),
                    profile_error: None,
                },
                fivem: FiveMStatus {
                    running: None,
                    error: Some(err),
                },
                checked_at: None,
            };
        }
    };

    let steam_running = names.iter().any(|n| n == "steam.exe");
    static DISCORD_RE: OnceLock<Regex> = OnceLock::new();
    let discord_re =
        DISCORD_RE.get_or_init(|| Regex::new(r"^discord(?:canary|ptb)?\.exe$").unwrap());
    let discord_running = names.iter().any(|n| discord_re.is_match(n));
    let fivem_running = names.iter().any(|n| is_fivem_process(n));

    let steam_fut = async {
        if !steam_running {
            return (None, None);
        }
        match tokio::task::spawn_blocking(get_steam_profile).await {
            Ok(Ok(u)) => (Some(u), None),
            Ok(Err(e)) => (None, Some(e)),
            Err(_) => (None, Some("อ่านบัญชี Steam ไม่สำเร็จ".into())),
        }
    };
    let discord_fut = async {
        if !discord_running {
            return (None, None);
        }
        match get_discord_profile().await {
            Ok(u) => (Some(u), None),
            Err(e) => (None, Some(e)),
        }
    };

    let ((steam_user, steam_profile_err), (discord_user, discord_profile_err)) =
        tokio::join!(steam_fut, discord_fut);

    SystemPresence {
        steam: ServiceStatus {
            running: Some(steam_running),
            user: steam_user,
            error: None,
            profile_error: steam_profile_err,
        },
        discord: ServiceStatus {
            running: Some(discord_running),
            user: discord_user,
            error: None,
            profile_error: discord_profile_err,
        },
        fivem: FiveMStatus {
            running: Some(fivem_running),
            error: None,
        },
        checked_at: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default(),
        ),
    }
}

fn e_msg_or_default() -> String {
    "อ่านรายการ process ของ Windows ไม่ได้".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vdf_and_process_names() {
        let vdf = r#"
        "users"
        {
            "76561198000000001"
            {
                "PersonaName" "Sora"
            }
        }
        "#;
        let parsed = parse_vdf(vdf).unwrap();
        let users = match parsed.get("users").unwrap() {
            VdfNode::Obj(m) => m,
            _ => panic!("expected obj"),
        };
        let u = match users.get("76561198000000001").unwrap() {
            VdfNode::Obj(m) => m,
            _ => panic!("expected user obj"),
        };
        assert!(matches!(u.get("PersonaName"), Some(VdfNode::Str(s)) if s == "Sora"));

        assert!(is_fivem_process("FiveM.exe"));
        assert!(is_fivem_process("FiveM_b3095_GTAProcess.exe"));
        assert!(!is_fivem_process("Estra FiveM Launcher.exe"));
        assert!(is_fivem_session_process("FiveM_b3095_GTAProcess.exe"));
    }

    #[test]
    fn builds_discord_cdn_avatar() {
        let user = serde_json::json!({
            "id": "123456789012345678",
            "username": "estra",
            "global_name": "Estra User",
            "avatar": "0123456789abcdef0123456789abcdef"
        });
        let profile = discord_profile_from_json(&user).unwrap();
        assert_eq!(profile.display_name, "Estra User");
        assert_eq!(
            profile.avatar_url.unwrap(),
            "https://cdn.discordapp.com/avatars/123456789012345678/0123456789abcdef0123456789abcdef.png?size=128"
        );
    }
}
