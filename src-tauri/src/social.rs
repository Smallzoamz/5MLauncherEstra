use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;
use uuid::Uuid;

const AVATAR_PALETTE: [&str; 7] = [
    "#2b6bf3", "#0ea5e9", "#6366f1", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899",
];
const ONLINE_WINDOW_MS: u64 = 45_000;
const SUPABASE_ORIGIN: &str = "https://hcynletyqztbbouwlcsg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_puj9yz5BQ_i3DEmhnpgmww_4fifPu5e";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredUser {
    id: String,
    username: String,
    display_name: String,
    friend_code: String,
    password_hash: String,
    avatar_color: String,
    #[serde(default)]
    avatar_url: Option<String>,
    status_pref: String,
    #[serde(default)]
    is_demo: bool,
    last_seen_ms: u64,
    current_server_id: Option<String>,
    current_server_name: Option<String>,
    current_server_ip: Option<String>,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredFriendship {
    user_id: String,
    friend_id: String,
    is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredFriendRequest {
    id: String,
    from_user_id: String,
    to_user_id: String,
    status: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredFavoriteServer {
    user_id: String,
    id: String,
    name: String,
    ip: String,
    tag: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredGameInvite {
    id: String,
    from_user_id: String,
    to_user_id: String,
    server_id: String,
    server_name: String,
    server_ip: String,
    status: String,
    created_at: String,
    expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct LocalSocialDb {
    users: Vec<StoredUser>,
    friendships: Vec<StoredFriendship>,
    friend_requests: Vec<StoredFriendRequest>,
    favorite_servers: Vec<StoredFavoriteServer>,
    #[serde(default)]
    game_invites: Vec<StoredGameInvite>,
    active_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RemoteSessionDisk {
    access_token: Option<String>,
    refresh_token: Option<String>,
}

pub struct SocialState {
    local_lock: Mutex<()>,
    remote_session: Mutex<Option<RemoteSessionDisk>>,
    http: Client,
}

impl Default for SocialState {
    fn default() -> Self {
        Self {
            local_lock: Mutex::new(()),
            remote_session: Mutex::new(None),
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(12))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn now_iso() -> String {
    let secs = now_ms() / 1000;
    format!("{}", secs)
}

fn social_data_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".estra-launcher")))
        .ok_or_else(|| "ไม่พบโฟลเดอร์เก็บข้อมูลผู้ใช้".to_string())?;
    let dir = base.join("EstraFiveMLauncher");
    fs::create_dir_all(&dir).map_err(|e| format!("สร้างโฟลเดอร์บัญชีไม่สำเร็จ: {e}"))?;
    Ok(dir)
}

fn db_file_path() -> Result<PathBuf, String> {
    Ok(social_data_dir()?.join("social-desktop.json"))
}

fn remote_session_file_path() -> Result<PathBuf, String> {
    Ok(social_data_dir()?.join("social-remote-session.json"))
}

fn load_remote_session_disk() -> RemoteSessionDisk {
    let Ok(path) = remote_session_file_path() else {
        return RemoteSessionDisk::default();
    };
    if !path.exists() {
        return RemoteSessionDisk::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<RemoteSessionDisk>(&raw).ok())
        .unwrap_or_default()
}

fn persist_remote_session_disk(session: &RemoteSessionDisk) {
    let Ok(path) = remote_session_file_path() else {
        return;
    };
    if session.access_token.is_none() && session.refresh_token.is_none() {
        let _ = fs::remove_file(&path);
        return;
    }
    if let Ok(data) = serde_json::to_string_pretty(session) {
        let tmp = path.with_extension("json.tmp");
        if fs::write(&tmp, data).is_ok() {
            let _ = fs::rename(&tmp, &path);
        }
    }
}

fn get_cached_remote_session(state: &SocialState) -> RemoteSessionDisk {
    if let Ok(mut guard) = state.remote_session.lock() {
        if let Some(existing) = guard.as_ref() {
            return existing.clone();
        }
        let loaded = load_remote_session_disk();
        *guard = Some(loaded.clone());
        return loaded;
    }
    RemoteSessionDisk::default()
}

fn update_cached_remote_session(state: &SocialState, access: Option<String>, refresh: Option<String>) {
    let next = RemoteSessionDisk {
        access_token: access.filter(|s| !s.is_empty()),
        refresh_token: refresh.filter(|s| !s.is_empty()),
    };
    if let Ok(mut guard) = state.remote_session.lock() {
        *guard = Some(next.clone());
    }
    persist_remote_session_disk(&next);
}

fn load_db() -> Result<LocalSocialDb, String> {
    let path = db_file_path()?;
    if !path.exists() {
        return Ok(LocalSocialDb::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("อ่านข้อมูลบัญชีไม่สำเร็จ: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("ข้อมูลบัญชีเสียหาย: {e}"))
}

fn save_db(db: &LocalSocialDb) -> Result<(), String> {
    let path = db_file_path()?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(db).map_err(|e| format!("แปลงข้อมูลไม่สำเร็จ: {e}"))?;
    fs::write(&tmp, data).map_err(|e| format!("บันทึกข้อมูลบัญชีไม่สำเร็จ: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("ย้ายไฟล์ข้อมูลไม่สำเร็จ: {e}"))?;
    Ok(())
}

fn stretch_hash(password: &str, salt: &str) -> String {
    let mut current = format!("{salt}:{password}").into_bytes();
    for _ in 0..10_000 {
        let mut hasher = Sha256::new();
        hasher.update(&current);
        current = hasher.finalize().to_vec();
    }
    format!("sha256x10k:{salt}:{}", hex::encode(current))
}

fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split(':').collect();
    if parts.len() != 3 || parts[0] != "sha256x10k" {
        return false;
    }
    let candidate = stretch_hash(password, parts[1]);
    candidate.as_bytes() == stored.as_bytes()
}

fn validate_username(username: &str) -> Result<String, String> {
    let clean = username.trim().to_lowercase();
    if clean.len() < 3
        || clean.len() > 24
        || !clean
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.' || c == '-')
    {
        return Err("ชื่อผู้ใช้ต้องยาว 3-24 ตัวอักษร (a-z, 0-9, _, ., -)".to_string());
    }
    Ok(clean)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.len() < 6 || password.len() > 128 {
        return Err("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร (สูงสุด 128 ตัวอักษร)".to_string());
    }
    Ok(())
}

fn validate_display_name(raw: Option<&str>, fallback: &str) -> Result<String, String> {
    let clean = raw.unwrap_or(fallback).trim();
    if clean.is_empty() || clean.chars().count() > 40 {
        return Err("ชื่อที่แสดงต้องยาว 1-40 ตัวอักษร".to_string());
    }
    Ok(clean.to_string())
}

fn generate_friend_code(existing: &HashSet<String>) -> String {
    let alphabet: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".chars().collect();
    loop {
        let raw = Uuid::new_v4().simple().to_string();
        let bytes = raw.as_bytes();
        let code: String = (0..4)
            .map(|i| alphabet[(bytes[i] as usize) % alphabet.len()])
            .collect();
        let full = format!("ESTRA-{code}");
        if !existing.contains(&full) {
            return full;
        }
    }
}

fn compute_presence(u: &StoredUser, now: u64) -> &'static str {
    if u.is_demo {
        return match u.status_pref.as_str() {
            "offline" => "offline",
            "away" => "away",
            _ if u.current_server_name.is_some() => "in-game",
            _ => "online",
        };
    }
    if u.status_pref == "offline" || u.status_pref == "invisible" {
        return "offline";
    }
    if now.saturating_sub(u.last_seen_ms) > ONLINE_WINDOW_MS {
        return "offline";
    }
    if u.status_pref == "away" {
        return "away";
    }
    if u.current_server_name.is_some() {
        return "in-game";
    }
    "online"
}

fn public_user(u: &StoredUser, now: u64, include_private: bool) -> Value {
    let presence = compute_presence(u, now);
    let current_server = if presence != "offline" {
        u.current_server_name.as_ref().map(|name| {
            json!({
                "id": u.current_server_id.clone().unwrap_or_default(),
                "name": name,
                "ip": u.current_server_ip.clone().unwrap_or_default(),
            })
        })
    } else {
        None
    };

    let mut obj = json!({
        "id": u.id,
        "username": u.username,
        "displayName": u.display_name,
        "friendCode": u.friend_code,
        "avatarColor": u.avatar_color,
        "avatarUrl": u.avatar_url.clone().unwrap_or_default(),
        "presence": presence,
        "isDemo": u.is_demo,
        "currentServer": current_server,
    });
    if include_private {
        obj["statusPref"] = json!(u.status_pref);
    }
    obj
}

fn user_favorite_servers(db: &LocalSocialDb, user_id: &str) -> Vec<Value> {
    db.favorite_servers
        .iter()
        .filter(|s| s.user_id == user_id)
        .map(|s| {
            json!({
                "id": s.id,
                "name": s.name,
                "ip": s.ip,
                "tag": s.tag,
                "createdAt": s.created_at,
            })
        })
        .collect()
}

fn build_social_state(db: &LocalSocialDb, user_id: &str) -> Result<Value, String> {
    let now = now_ms();
    let me = db
        .users
        .iter()
        .find(|u| u.id == user_id)
        .ok_or_else(|| "ไม่พบบัญชีผู้ใช้".to_string())?;

    let mut friends: Vec<Value> = db
        .friendships
        .iter()
        .filter(|f| f.user_id == user_id)
        .filter_map(|f| {
            db.users.iter().find(|u| u.id == f.friend_id).map(|u| {
                let mut val = public_user(u, now, false);
                val["isFavorite"] = json!(f.is_favorite);
                val
            })
        })
        .collect();

    friends.sort_by(|a, b| {
        let fav_a = a["isFavorite"].as_bool().unwrap_or(false);
        let fav_b = b["isFavorite"].as_bool().unwrap_or(false);
        fav_b.cmp(&fav_a).then_with(|| {
            let rank = |p: &str| match p {
                "in-game" => 0,
                "online" => 1,
                "away" => 2,
                _ => 3,
            };
            let ra = rank(a["presence"].as_str().unwrap_or("offline"));
            let rb = rank(b["presence"].as_str().unwrap_or("offline"));
            ra.cmp(&rb)
        })
    });

    let incoming: Vec<Value> = db
        .friend_requests
        .iter()
        .filter(|r| r.to_user_id == user_id && r.status == "pending")
        .filter_map(|r| {
            db.users.iter().find(|u| u.id == r.from_user_id).map(|u| {
                json!({
                    "id": r.id,
                    "createdAt": r.created_at,
                    "user": public_user(u, now, false),
                })
            })
        })
        .collect();

    let outgoing: Vec<Value> = db
        .friend_requests
        .iter()
        .filter(|r| r.from_user_id == user_id && r.status == "pending")
        .filter_map(|r| {
            db.users.iter().find(|u| u.id == r.to_user_id).map(|u| {
                json!({
                    "id": r.id,
                    "createdAt": r.created_at,
                    "user": public_user(u, now, false),
                })
            })
        })
        .collect();

    let incoming_invites: Vec<Value> = db
        .game_invites
        .iter()
        .filter(|gi| gi.to_user_id == user_id && gi.status == "pending" && gi.expires_at_ms > now)
        .filter_map(|gi| {
            db.users.iter().find(|u| u.id == gi.from_user_id).map(|u| {
                json!({
                    "id": gi.id,
                    "createdAt": gi.created_at,
                    "server": { "id": gi.server_id, "name": gi.server_name, "ip": gi.server_ip },
                    "fromUser": public_user(u, now, false),
                })
            })
        })
        .collect();

    let outgoing_invites: Vec<Value> = db
        .game_invites
        .iter()
        .filter(|gi| gi.from_user_id == user_id && gi.status == "pending" && gi.expires_at_ms > now)
        .filter_map(|gi| {
            db.users.iter().find(|u| u.id == gi.to_user_id).map(|u| {
                json!({
                    "id": gi.id,
                    "createdAt": gi.created_at,
                    "server": { "id": gi.server_id, "name": gi.server_name, "ip": gi.server_ip },
                    "toUser": public_user(u, now, false),
                })
            })
        })
        .collect();

    Ok(json!({
        "success": true,
        "mode": "local-desktop",
        "user": public_user(me, now, true),
        "favoriteServers": user_favorite_servers(db, user_id),
        "friends": friends,
        "incomingRequests": incoming,
        "outgoingRequests": outgoing,
        "incomingInvites": incoming_invites,
        "outgoingInvites": outgoing_invites,
    }))
}

fn handle_local(state: &SocialState, path: &str, body: Value) -> Result<Value, String> {
    let _guard = state
        .local_lock
        .lock()
        .map_err(|_| "ไม่สามารถล็อกฐานข้อมูลบัญชีได้".to_string())?;
    let mut db = load_db()?;
    let now = now_ms();

    let route = path.split('?').next().unwrap_or(path);
    let query_str = path.split('?').nth(1).unwrap_or("");

    match route {
        "/api/social/me" => {
            if let Some(uid) = db.active_user_id.clone() {
                if let Some(u) = db.users.iter().find(|u| u.id == uid) {
                    return Ok(json!({
                        "success": true,
                        "authenticated": true,
                        "mode": "local-desktop",
                        "user": public_user(u, now, true),
                        "favoriteServers": user_favorite_servers(&db, &uid),
                    }));
                }
            }
            Ok(json!({
                "success": true,
                "authenticated": false,
                "mode": "local-desktop",
                "user": null,
                "favoriteServers": [],
            }))
        }
        "/api/social/register" => {
            let username = validate_username(body["username"].as_str().unwrap_or(""))?;
            let password = body["password"].as_str().unwrap_or("");
            validate_password(password)?;
            let display_name =
                validate_display_name(body["displayName"].as_str(), &username)?;
            if db.users.iter().any(|u| u.username == username) {
                return Err("ชื่อผู้ใช้นี้ถูกใช้งานแล้ว".to_string());
            }
            let codes: HashSet<String> = db.users.iter().map(|u| u.friend_code.clone()).collect();
            let friend_code = generate_friend_code(&codes);
            let salt = Uuid::new_v4().simple().to_string();
            let color_idx = (Uuid::new_v4().as_bytes()[0] as usize) % AVATAR_PALETTE.len();
            let user = StoredUser {
                id: Uuid::new_v4().to_string(),
                username,
                display_name,
                friend_code,
                password_hash: stretch_hash(password, &salt),
                avatar_color: AVATAR_PALETTE[color_idx].to_string(),
                avatar_url: None,
                status_pref: "online".to_string(),
                is_demo: false,
                last_seen_ms: now,
                current_server_id: None,
                current_server_name: None,
                current_server_ip: None,
                created_at: now_iso(),
            };
            let uid = user.id.clone();
            db.users.push(user.clone());
            db.active_user_id = Some(uid);
            save_db(&db)?;
            Ok(json!({
                "success": true,
                "authenticated": true,
                "mode": "local-desktop",
                "user": public_user(&user, now, true),
                "favoriteServers": [],
            }))
        }
        "/api/social/login" => {
            let username = body["username"].as_str().unwrap_or("").trim().to_lowercase();
            let password = body["password"].as_str().unwrap_or("");
            if username.is_empty() || password.is_empty() {
                return Err("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน".to_string());
            }
            let idx = db
                .users
                .iter()
                .position(|u| u.username == username && !u.is_demo)
                .ok_or_else(|| "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง".to_string())?;
            if !verify_password(password, &db.users[idx].password_hash) {
                return Err("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง".to_string());
            }
            db.users[idx].last_seen_ms = now;
            let user = db.users[idx].clone();
            let uid = user.id.clone();
            db.active_user_id = Some(uid.clone());
            save_db(&db)?;
            Ok(json!({
                "success": true,
                "authenticated": true,
                "mode": "local-desktop",
                "user": public_user(&user, now, true),
                "favoriteServers": user_favorite_servers(&db, &uid),
            }))
        }
        "/api/social/logout" => {
            db.active_user_id = None;
            save_db(&db)?;
            Ok(json!({ "success": true, "authenticated": false, "user": null }))
        }
        _ => {
            let uid = db
                .active_user_id
                .clone()
                .ok_or_else(|| "กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน".to_string())?;
            match route {
                "/api/social/state" => build_social_state(&db, &uid),
                "/api/social/search" => {
                    let q_raw = query_str
                        .split('&')
                        .find_map(|p| p.strip_prefix("q="))
                        .unwrap_or("");
                    let q = url::form_urlencoded::parse(q_raw.as_bytes())
                        .map(|(k, v)| if v.is_empty() { k.to_string() } else { format!("{k}={v}") })
                        .collect::<String>()
                        .trim()
                        .to_lowercase();
                    if q.len() < 2 {
                        return Ok(json!({ "success": true, "users": [] }));
                    }
                    let users: Vec<Value> = db
                        .users
                        .iter()
                        .filter(|u| {
                            u.id != uid
                                && (u.username.contains(&q)
                                    || u.display_name.to_lowercase().contains(&q)
                                    || u.friend_code.to_lowercase() == q)
                        })
                        .take(12)
                        .map(|u| {
                            let is_friend = db
                                .friendships
                                .iter()
                                .any(|f| f.user_id == uid && f.friend_id == u.id);
                            let out_req = db.friend_requests.iter().any(|r| {
                                r.from_user_id == uid && r.to_user_id == u.id && r.status == "pending"
                            });
                            let in_req = db.friend_requests.iter().find(|r| {
                                r.from_user_id == u.id && r.to_user_id == uid && r.status == "pending"
                            });
                            let mut val = public_user(u, now, false);
                            val["relation"] = json!(if is_friend {
                                "friend"
                            } else if out_req {
                                "pending_out"
                            } else if in_req.is_some() {
                                "pending_in"
                            } else {
                                "none"
                            });
                            val["incomingRequestId"] = json!(in_req.map(|r| r.id.clone()));
                            val
                        })
                        .collect();
                    Ok(json!({ "success": true, "users": users }))
                }
                "/api/social/heartbeat" => {
                    let idx = db
                        .users
                        .iter()
                        .position(|u| u.id == uid)
                        .ok_or_else(|| "ไม่พบบัญชีผู้ใช้".to_string())?;
                    if let Some(pref) = body["statusPref"].as_str() {
                        if !["online", "away", "invisible", "offline"].contains(&pref) {
                            return Err("สถานะออนไลน์ไม่ถูกต้อง".to_string());
                        }
                        db.users[idx].status_pref = pref.to_string();
                    }
                    if let Some(dn) = body["displayName"].as_str() {
                        db.users[idx].display_name = validate_display_name(Some(dn), &db.users[idx].display_name)?;
                    }
                    db.users[idx].last_seen_ms = now;
                    if body["activeServer"].is_object() {
                        let srv = &body["activeServer"];
                        let name = srv["name"].as_str().unwrap_or("").trim();
                        if !name.is_empty() {
                            db.users[idx].current_server_id =
                                srv["id"].as_str().map(|s| s.chars().take(100).collect());
                            db.users[idx].current_server_name =
                                Some(name.chars().take(100).collect());
                            db.users[idx].current_server_ip =
                                srv["ip"].as_str().map(|s| s.chars().take(253).collect());
                        } else {
                            db.users[idx].current_server_id = None;
                            db.users[idx].current_server_name = None;
                            db.users[idx].current_server_ip = None;
                        }
                    } else if body.get("activeServer").is_some_and(|v| v.is_null()) {
                        db.users[idx].current_server_id = None;
                        db.users[idx].current_server_name = None;
                        db.users[idx].current_server_ip = None;
                    }
                    let user = db.users[idx].clone();
                    save_db(&db)?;
                    Ok(json!({ "success": true, "user": public_user(&user, now, true) }))
                }
                "/api/social/profile-update" => {
                    let idx = db
                        .users
                        .iter()
                        .position(|u| u.id == uid)
                        .ok_or_else(|| "ไม่พบบัญชีผู้ใช้".to_string())?;
                    if let Some(dn) = body["displayName"].as_str() {
                        db.users[idx].display_name =
                            validate_display_name(Some(dn), &db.users[idx].display_name)?;
                    }
                    if let Some(col) = body["avatarColor"].as_str() {
                        let clean_col = col.trim().to_lowercase();
                        if !AVATAR_PALETTE.contains(&clean_col.as_str()) {
                            return Err("สีโปรไฟล์ไม่ถูกต้อง".to_string());
                        }
                        db.users[idx].avatar_color = clean_col;
                    }
                    if let Some(raw_url) = body.get("avatarUrl") {
                        if raw_url.is_null() {
                            db.users[idx].avatar_url = None;
                        } else if let Some(s) = raw_url.as_str() {
                            let val = s.trim();
                            if val.is_empty() {
                                db.users[idx].avatar_url = None;
                            } else if val.to_lowercase().starts_with("data:image/svg+xml") {
                                return Err("ไม่รองรับไฟล์ SVG สำหรับรูปโปรไฟล์".to_string());
                            } else if val.to_lowercase().starts_with("data:image/") {
                                let valid_prefix = ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/jpg;base64,", "data:image/webp;base64,"]
                                    .iter()
                                    .any(|p| val.len() > p.len() && val[..p.len()].eq_ignore_ascii_case(p));
                                if !valid_prefix || val.len() > 45_000 || val.chars().any(|c| c.is_whitespace()) {
                                    return Err("รูปโปรไฟล์ไม่ถูกต้องหรือมีขนาดใหญ่เกินกำหนด".to_string());
                                }
                                db.users[idx].avatar_url = Some(val.to_string());
                            } else {
                                if val.len() > 500 || val.chars().any(|c| c.is_whitespace()) {
                                    return Err("ลิงก์รูปโปรไฟล์ต้องเป็น HTTPS ความยาวไม่เกิน 500 ตัวอักษร".to_string());
                                }
                                let parsed = Url::parse(val)
                                    .map_err(|_| "รูปแบบลิงก์รูปโปรไฟล์ไม่ถูกต้อง".to_string())?;
                                if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
                                    return Err("ลิงก์รูปโปรไฟล์ต้องขึ้นต้นด้วย https://".to_string());
                                }
                                db.users[idx].avatar_url = Some(parsed.to_string());
                            }
                        } else {
                            return Err("ข้อมูลรูปโปรไฟล์ไม่ถูกต้อง".to_string());
                        }
                    }
                    let user = db.users[idx].clone();
                    save_db(&db)?;
                    Ok(json!({
                        "success": true,
                        "user": public_user(&user, now, true),
                        "message": "บันทึกข้อมูลโปรไฟล์แล้ว"
                    }))
                }
                "/api/social/friend-request" => {
                    let target = body["target"].as_str().unwrap_or("").trim();
                    if target.is_empty() {
                        return Err("กรุณาระบุชื่อผู้ใช้หรือรหัสเพื่อน (เช่น ESTRA-XXXX)".to_string());
                    }
                    let target_user = db
                        .users
                        .iter()
                        .find(|u| {
                            u.username == target.to_lowercase()
                                || u.friend_code.eq_ignore_ascii_case(target)
                        })
                        .cloned()
                        .ok_or_else(|| "ไม่พบบัญชีผู้ใช้นี้".to_string())?;
                    if target_user.id == uid {
                        return Err("ไม่สามารถเพิ่มตัวเองเป็นเพื่อนได้".to_string());
                    }
                    if db
                        .friendships
                        .iter()
                        .any(|f| f.user_id == uid && f.friend_id == target_user.id)
                    {
                        return Err(format!("{} เป็นเพื่อนของคุณอยู่แล้ว", target_user.display_name));
                    }
                    if db.friend_requests.iter().any(|r| {
                        r.from_user_id == uid && r.to_user_id == target_user.id && r.status == "pending"
                    }) {
                        return Err("ส่งคำขอเป็นเพื่อนไปแล้ว กรุณารอการตอบรับ".to_string());
                    }
                    if let Some(rev) = db.friend_requests.iter_mut().find(|r| {
                        r.from_user_id == target_user.id && r.to_user_id == uid && r.status == "pending"
                    }) {
                        rev.status = "accepted".to_string();
                        db.friendships.push(StoredFriendship {
                            user_id: uid.clone(),
                            friend_id: target_user.id.clone(),
                            is_favorite: false,
                        });
                        db.friendships.push(StoredFriendship {
                            user_id: target_user.id.clone(),
                            friend_id: uid.clone(),
                            is_favorite: false,
                        });
                    } else {
                        db.friend_requests.push(StoredFriendRequest {
                            id: Uuid::new_v4().to_string(),
                            from_user_id: uid.clone(),
                            to_user_id: target_user.id.clone(),
                            status: "pending".to_string(),
                            created_at: now_iso(),
                        });
                    }
                    save_db(&db)?;
                    build_social_state(&db, &uid)
                }
                "/api/social/friend-respond" => {
                    let req_id = body["requestId"].as_str().unwrap_or("");
                    let action = body["action"].as_str().unwrap_or("");
                    let idx = db
                        .friend_requests
                        .iter()
                        .position(|r| r.id == req_id && r.status == "pending")
                        .ok_or_else(|| "ไม่พบคำขอเป็นเพื่อน".to_string())?;
                    let req = db.friend_requests[idx].clone();
                    match action {
                        "cancel" => {
                            if req.from_user_id != uid {
                                return Err("ไม่มีสิทธิ์ยกเลิกคำขอนี้".to_string());
                            }
                            db.friend_requests.remove(idx);
                        }
                        "accept" => {
                            if req.to_user_id != uid {
                                return Err("ไม่มีสิทธิ์จัดการคำขอนี้".to_string());
                            }
                            db.friend_requests[idx].status = "accepted".to_string();
                            if !db
                                .friendships
                                .iter()
                                .any(|f| f.user_id == req.from_user_id && f.friend_id == req.to_user_id)
                            {
                                db.friendships.push(StoredFriendship {
                                    user_id: req.from_user_id.clone(),
                                    friend_id: req.to_user_id.clone(),
                                    is_favorite: false,
                                });
                                db.friendships.push(StoredFriendship {
                                    user_id: req.to_user_id,
                                    friend_id: req.from_user_id,
                                    is_favorite: false,
                                });
                            }
                        }
                        "decline" => {
                            if req.to_user_id != uid {
                                return Err("ไม่มีสิทธิ์จัดการคำขอนี้".to_string());
                            }
                            db.friend_requests[idx].status = "declined".to_string();
                        }
                        _ => return Err("คำสั่งไม่ถูกต้อง".to_string()),
                    }
                    save_db(&db)?;
                    build_social_state(&db, &uid)
                }
                "/api/social/friend-favorite" => {
                    let friend_id = body["friendId"].as_str().unwrap_or("");
                    let entry = db
                        .friendships
                        .iter_mut()
                        .find(|f| f.user_id == uid && f.friend_id == friend_id)
                        .ok_or_else(|| "ไม่พบรายชื่อเพื่อนนี้".to_string())?;
                    entry.is_favorite = body["favorite"].as_bool().unwrap_or(!entry.is_favorite);
                    save_db(&db)?;
                    build_social_state(&db, &uid)
                }
                "/api/social/friend-remove" => {
                    let friend_id = body["friendId"].as_str().unwrap_or("");
                    db.friendships.retain(|f| {
                        !((f.user_id == uid && f.friend_id == friend_id)
                            || (f.user_id == friend_id && f.friend_id == uid))
                    });
                    save_db(&db)?;
                    build_social_state(&db, &uid)
                }
                "/api/social/server-favorite" => {
                    let srv = &body["server"];
                    let sid = srv["id"].as_str().unwrap_or("").trim();
                    if sid.is_empty() {
                        return Err("ข้อมูลเซิร์ฟเวอร์ไม่ถูกต้อง".to_string());
                    }
                    let exists = db
                        .favorite_servers
                        .iter()
                        .position(|s| s.user_id == uid && s.id == sid);
                    let want = body["favorite"].as_bool().unwrap_or(exists.is_none());
                    if want {
                        let rec = StoredFavoriteServer {
                            user_id: uid.clone(),
                            id: sid.chars().take(100).collect(),
                            name: srv["name"].as_str().unwrap_or(sid).chars().take(100).collect(),
                            ip: srv["ip"].as_str().unwrap_or("").chars().take(253).collect(),
                            tag: srv["tag"].as_str().unwrap_or("").chars().take(40).collect(),
                            created_at: now_iso(),
                        };
                        if let Some(pos) = exists {
                            db.favorite_servers[pos] = rec;
                        } else {
                            db.favorite_servers.push(rec);
                        }
                    } else if let Some(pos) = exists {
                        db.favorite_servers.remove(pos);
                    }
                    save_db(&db)?;
                    Ok(json!({
                        "success": true,
                        "favoriteServers": user_favorite_servers(&db, &uid),
                    }))
                }
                "/api/social/demo-seed" => {
                    let samples = [
                        ("demo-sacrig", "sacrig_demo", "Sacrig", "ESTRA-DEMO1", "#2b6bf3", "online", Some(("noxtis-legacy", "Noxtis Legacy", "89.38.101.136:30120")), true),
                        ("demo-octalise", "octalise_demo", "Octalise", "ESTRA-DEMO2", "#10b981", "online", Some(("noxtis-legacy", "Noxtis Legacy", "89.38.101.136:30120")), true),
                        ("demo-aquanova", "aquanova_demo", "AquaNova", "ESTRA-DEMO3", "#0ea5e9", "away", None, false),
                        ("demo-crimson", "crimson_demo", "CrimsonWhisper", "ESTRA-DEMO4", "#8b5cf6", "offline", None, false),
                    ];
                    for (id, uname, dname, code, color, pref, srv, fav) in samples {
                        if !db.users.iter().any(|u| u.id == id) {
                            db.users.push(StoredUser {
                                id: id.to_string(),
                                username: uname.to_string(),
                                display_name: dname.to_string(),
                                friend_code: code.to_string(),
                                password_hash: "demo-locked".to_string(),
                                avatar_color: color.to_string(),
                                avatar_url: None,
                                status_pref: pref.to_string(),
                                is_demo: true,
                                last_seen_ms: now,
                                current_server_id: srv.map(|s| s.0.to_string()),
                                current_server_name: srv.map(|s| s.1.to_string()),
                                current_server_ip: srv.map(|s| s.2.to_string()),
                                created_at: now_iso(),
                            });
                        }
                        if !db
                            .friendships
                            .iter()
                            .any(|f| f.user_id == uid && f.friend_id == id)
                        {
                            db.friendships.push(StoredFriendship {
                                user_id: uid.clone(),
                                friend_id: id.to_string(),
                                is_favorite: fav,
                            });
                        }
                    }
                    save_db(&db)?;
                    build_social_state(&db, &uid)
                }
                "/api/social/game-invite" => {
                    let fid = body["friendId"].as_str().unwrap_or("").trim();
                    if fid.is_empty() || fid == uid {
                        return Err("ไม่พบเพื่อนที่ต้องการชวน".to_string());
                    }
                    if !db.friendships.iter().any(|f| f.user_id == uid && f.friend_id == fid) {
                        return Err("สามารถชวนได้เฉพาะผู้ที่เป็นเพื่อนกันเท่านั้น".to_string());
                    }
                    let friend_name = db
                        .users
                        .iter()
                        .find(|u| u.id == fid && !u.is_demo)
                        .map(|u| u.display_name.clone())
                        .ok_or_else(|| "ไม่สามารถส่งคำชวนให้บัญชีตัวอย่างได้".to_string())?;
                    let srv = &body["server"];
                    let sid = srv["id"].as_str().unwrap_or("").trim();
                    let sname = srv["name"].as_str().unwrap_or("").trim();
                    let sip = srv["ip"].as_str().unwrap_or("").trim();
                    if sid.is_empty() || sname.is_empty() || sip.is_empty() {
                        return Err("กรุณาเลือกเมืองก่อนชวนเพื่อน".to_string());
                    }
                    for gi in &mut db.game_invites {
                        if gi.from_user_id == uid && gi.to_user_id == fid && gi.status == "pending" {
                            gi.status = "cancelled".to_string();
                        }
                    }
                    db.game_invites.push(StoredGameInvite {
                        id: Uuid::new_v4().to_string(),
                        from_user_id: uid.clone(),
                        to_user_id: fid.to_string(),
                        server_id: sid.chars().take(100).collect(),
                        server_name: sname.chars().take(100).collect(),
                        server_ip: sip.chars().take(253).collect(),
                        status: "pending".to_string(),
                        created_at: now_iso(),
                        expires_at_ms: now + 300_000,
                    });
                    save_db(&db)?;
                    let mut st = build_social_state(&db, &uid)?;
                    st["message"] = json!(format!("ส่งคำชวนเข้าเล่น {sname} ไปยัง {friend_name} แล้ว"));
                    Ok(st)
                }
                "/api/social/game-invite-respond" => {
                    let iid = body["inviteId"].as_str().unwrap_or("");
                    let act = body["action"].as_str().unwrap_or("");
                    let pos = db
                        .game_invites
                        .iter()
                        .position(|gi| gi.id == iid && gi.status == "pending")
                        .ok_or_else(|| "คำชวนหมดอายุหรือถูกจัดการแล้ว".to_string())?;
                    if db.game_invites[pos].expires_at_ms <= now {
                        db.game_invites[pos].status = "expired".to_string();
                        save_db(&db)?;
                        return Err("คำชวนหมดอายุแล้ว".to_string());
                    }
                    let inv_server = json!({
                        "id": db.game_invites[pos].server_id,
                        "name": db.game_invites[pos].server_name,
                        "ip": db.game_invites[pos].server_ip,
                    });
                    match act {
                        "cancel" => {
                            if db.game_invites[pos].from_user_id != uid {
                                return Err("ไม่มีสิทธิ์ยกเลิกคำชวนนี้".to_string());
                            }
                            db.game_invites[pos].status = "cancelled".to_string();
                        }
                        "accept" | "decline" => {
                            if db.game_invites[pos].to_user_id != uid {
                                return Err("ไม่มีสิทธิ์จัดการคำชวนนี้".to_string());
                            }
                            db.game_invites[pos].status = if act == "accept" { "accepted" } else { "declined" }.to_string();
                        }
                        _ => return Err("คำสั่งไม่ถูกต้อง".to_string()),
                    }
                    save_db(&db)?;
                    let mut st = build_social_state(&db, &uid)?;
                    st["inviteServer"] = inv_server;
                    Ok(st)
                }
                _ => Err("Social route not found".to_string()),
            }
        }
    }
}

pub async fn social_request(
    state: &SocialState,
    method: String,
    path: String,
    body: Option<Value>,
    social_server_url: Option<String>,
) -> Result<Value, String> {
    if let Some(raw_url) = social_server_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("local"))
    {
        let parsed = Url::parse(raw_url).map_err(|_| "URL ของ Social Server ไม่ถูกต้อง".to_string())?;
        if !["http", "https"].contains(&parsed.scheme())
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Social Server URL ต้องเป็น HTTP หรือ HTTPS ที่ปลอดภัย".to_string());
        }
        let origin = parsed.origin().ascii_serialization();
        let is_supabase = origin == SUPABASE_ORIGIN && parsed.path().starts_with("/functions/v1/");
        let base = format!("{origin}{}", parsed.path().trim_end_matches('/'));

        let is_realtime_token_req = path == "/api/social/realtime-token";
        if is_realtime_token_req {
            let sess = get_cached_remote_session(state);
            if !is_supabase {
                if sess.access_token.is_none() {
                    return Err("กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน".to_string());
                }
                return Ok(json!({ "success": true, "mode": "remote", "accessToken": Value::Null }));
            }
            if let Some(tok) = sess.access_token.clone() {
                return Ok(json!({ "success": true, "mode": "supabase", "accessToken": tok }));
            }
            if sess.refresh_token.is_none() {
                return Err("กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน".to_string());
            }
        }

        let upstream_path = if is_realtime_token_req {
            "/api/social/me"
        } else {
            path.as_str()
        };
        let full_url = format!("{base}{upstream_path}");
        let mut req = if !is_realtime_token_req && method.eq_ignore_ascii_case("POST") {
            state.http.post(&full_url).json(&body.unwrap_or_else(|| json!({})))
        } else {
            state.http.get(&full_url)
        };

        let sess = get_cached_remote_session(state);
        if let Some(tok) = sess.access_token.as_deref() {
            req = req.bearer_auth(tok);
        }
        if is_supabase {
            req = req.header("apikey", SUPABASE_PUBLISHABLE_KEY);
            if let Some(rtok) = sess.refresh_token.as_deref() {
                req = req.header("X-Refresh-Token", rtok);
            }
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("เชื่อมต่อ Social Server ไม่สำเร็จ: {e}"))?;
        let status = resp.status();
        let mut data: Value = resp
            .json()
            .await
            .map_err(|_| "คำตอบจาก Social Server ไม่ใช่ JSON ที่ถูกต้อง".to_string())?;

        if !status.is_success() || data["success"] == json!(false) {
            let msg = data["error"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
            return Err(msg);
        }

        let new_access = data["token"].as_str().map(|s| s.to_string());
        let new_refresh = data["refreshToken"].as_str().map(|s| s.to_string());
        if new_access.is_some() || new_refresh.is_some() {
            let merged_access = new_access.clone().or(sess.access_token);
            let merged_refresh = new_refresh.or(sess.refresh_token);
            update_cached_remote_session(state, merged_access.clone(), merged_refresh);
            if let Some(obj) = data.as_object_mut() {
                obj.remove("token");
                obj.remove("refreshToken");
            }
            if is_realtime_token_req {
                return Ok(json!({
                    "success": true,
                    "mode": "supabase",
                    "accessToken": merged_access
                }));
            }
        } else if is_realtime_token_req {
            return Err("กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน".to_string());
        }

        if path.starts_with("/api/social/logout")
            || (upstream_path == "/api/social/me" && data["authenticated"] == json!(false))
        {
            update_cached_remote_session(state, None, None);
        }
        return Ok(data);
    }

    if path == "/api/social/realtime-token" {
        let _guard = state.local_lock.lock().map_err(|_| "Lock error".to_string())?;
        let db = load_db()?;
        if db.active_user_id.is_none() {
            return Err("กรุณาเข้าสู่ระบบบัญชี Estra ก่อนใช้งาน".to_string());
        }
        return Ok(json!({ "success": true, "mode": "local-desktop", "accessToken": Value::Null }));
    }

    handle_local(state, &path, body.unwrap_or_else(|| json!({})))
}
