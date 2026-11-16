use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use url::Url;

pub mod generated {
    include!(concat!(env!("OUT_DIR"), "/integrity_consts.rs"));
}

static TAMPER_FLAG: AtomicBool = AtomicBool::new(false);

pub fn is_tampered() -> bool {
    TAMPER_FLAG.load(Ordering::Acquire)
}

pub fn mark_tampered() {
    TAMPER_FLAG.store(true, Ordering::Release);
}

pub fn decode_obf(enc: &[u8]) -> String {
    let mask = &generated::SHIELD_MASK;
    let decoded: Vec<u8> = enc
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ mask[i % mask.len()] ^ ((i as u8).wrapping_mul(31)))
        .collect();
    String::from_utf8(decoded).unwrap_or_default()
}

pub fn supabase_origin() -> &'static str {
    static VAL: OnceLock<String> = OnceLock::new();
    VAL.get_or_init(|| decode_obf(generated::OBF_SUPABASE_ORIGIN))
}

pub fn supabase_publishable_key() -> &'static str {
    static VAL: OnceLock<String> = OnceLock::new();
    VAL.get_or_init(|| decode_obf(generated::OBF_SUPABASE_KEY))
}

pub fn default_github_repo() -> &'static str {
    static VAL: OnceLock<String> = OnceLock::new();
    VAL.get_or_init(|| decode_obf(generated::OBF_GITHUB_REPO))
}

pub fn discord_application_id() -> &'static str {
    static VAL: OnceLock<String> = OnceLock::new();
    VAL.get_or_init(|| decode_obf(generated::OBF_DISCORD_APP_ID))
}

pub fn expected_product_name() -> &'static str {
    static VAL: OnceLock<String> = OnceLock::new();
    VAL.get_or_init(|| decode_obf(generated::OBF_PRODUCT_NAME))
}

pub fn expected_identifier() -> &'static str {
    static VAL: OnceLock<String> = OnceLock::new();
    VAL.get_or_init(|| decode_obf(generated::OBF_IDENTIFIER))
}

pub fn verify_brand_integrity(
    actual_product_name: &str,
    actual_identifier: &str,
) -> bool {
    let updater_pubkey = decode_obf(generated::OBF_UPDATER_PUBKEY);
    let updater_endpoint = decode_obf(generated::OBF_UPDATER_ENDPOINT);
    let tuple = format!(
        "{actual_product_name}|{actual_identifier}|{updater_pubkey}|{updater_endpoint}|{}|{}|{}",
        default_github_repo(),
        supabase_origin(),
        discord_application_id()
    );
    let mut hasher = Sha256::new();
    hasher.update(tuple.as_bytes());
    let digest = hex::encode(hasher.finalize());
    digest == generated::EXPECTED_BRAND_DIGEST
}

pub const fn fnv1a64_ascii_lower(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut i = 0;
    while i < bytes.len() {
        let b = if bytes[i] >= b'A' && bytes[i] <= b'Z' {
            bytes[i] + 32
        } else {
            bytes[i]
        };
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
        i += 1;
    }
    hash
}

const BLOCKED_RE_PROCESS_HASHES: &[u64] = &[
    fnv1a64_ascii_lower(b"x64dbg.exe"),
    fnv1a64_ascii_lower(b"x32dbg.exe"),
    fnv1a64_ascii_lower(b"ollydbg.exe"),
    fnv1a64_ascii_lower(b"ida.exe"),
    fnv1a64_ascii_lower(b"ida64.exe"),
    fnv1a64_ascii_lower(b"idag.exe"),
    fnv1a64_ascii_lower(b"idag64.exe"),
    fnv1a64_ascii_lower(b"idaw.exe"),
    fnv1a64_ascii_lower(b"idaw64.exe"),
    fnv1a64_ascii_lower(b"scylla_x64.exe"),
    fnv1a64_ascii_lower(b"scylla_x86.exe"),
    fnv1a64_ascii_lower(b"dnspy.exe"),
    fnv1a64_ascii_lower(b"ilspy.exe"),
    fnv1a64_ascii_lower(b"die.exe"),
    fnv1a64_ascii_lower(b"pe-bear.exe"),
    fnv1a64_ascii_lower(b"pestudio.exe"),
    fnv1a64_ascii_lower(b"resourcehacker.exe"),
    fnv1a64_ascii_lower(b"reshacker.exe"),
    fnv1a64_ascii_lower(b"cff explorer.exe"),
    fnv1a64_ascii_lower(b"lordpe.exe"),
    fnv1a64_ascii_lower(b"megadumper.exe"),
    fnv1a64_ascii_lower(b"extremedumper.exe"),
    fnv1a64_ascii_lower(b"httpdebuggerui.exe"),
    fnv1a64_ascii_lower(b"httpdebuggersvc.exe"),
    fnv1a64_ascii_lower(b"fiddler.exe"),
    fnv1a64_ascii_lower(b"fiddler everywhere.exe"),
    fnv1a64_ascii_lower(b"charles.exe"),
    fnv1a64_ascii_lower(b"cheatengine-x86_64.exe"),
    fnv1a64_ascii_lower(b"cheatengine-x86_64-sse4-avx2.exe"),
    fnv1a64_ascii_lower(b"cheatengine-i386.exe"),
    fnv1a64_ascii_lower(b"processhacker.exe"),
    fnv1a64_ascii_lower(b"systeminformer.exe"),
    fnv1a64_ascii_lower(b"frida-server.exe"),
];

const BLOCKED_RE_MODULE_HASHES: &[u64] = &[
    fnv1a64_ascii_lower(b"frida-agent.dll"),
    fnv1a64_ascii_lower(b"frida-gadget.dll"),
    fnv1a64_ascii_lower(b"scyllahide.dll"),
    fnv1a64_ascii_lower(b"scyllahide_x64.dll"),
    fnv1a64_ascii_lower(b"scyllahide_x86.dll"),
    fnv1a64_ascii_lower(b"titanhide.dll"),
    fnv1a64_ascii_lower(b"vehdebug-x86_64.dll"),
    fnv1a64_ascii_lower(b"vehdebug-i386.dll"),
    fnv1a64_ascii_lower(b"speedhack-x86_64.dll"),
    fnv1a64_ascii_lower(b"speedhack-i386.dll"),
    fnv1a64_ascii_lower(b"luaclient-x86_64.dll"),
];

pub fn is_re_tool_process(exe_name: &str) -> bool {
    let trimmed = exe_name.trim();
    if trimmed.is_empty() {
        return false;
    }
    let h = fnv1a64_ascii_lower(trimmed.as_bytes());
    BLOCKED_RE_PROCESS_HASHES.contains(&h)
}

pub fn is_re_module_name(module_name: &str) -> bool {
    let trimmed = module_name.trim();
    if trimmed.is_empty() {
        return false;
    }
    let h = fnv1a64_ascii_lower(trimmed.as_bytes());
    BLOCKED_RE_MODULE_HASHES.contains(&h)
}

pub fn is_allowed_webview_label(label: &str, allow_overlay: bool) -> bool {
    label == "main" || (allow_overlay && (label == "overlay" || label == "perf-overlay"))
}

pub fn is_allowed_webview_url(url: &Url, is_release: bool) -> bool {
    if url.scheme() == "tauri" {
        return true;
    }
    if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost") {
        return true;
    }
    if !is_release
        && matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
    {
        return true;
    }
    false
}

pub fn verify_ipc_caller(webview: &tauri::Webview, allow_overlay: bool) -> Result<(), String> {
    if is_tampered() {
        return Err("ไม่สามารถดำเนินการได้ในขณะนี้".to_string());
    }
    if !is_allowed_webview_label(webview.label(), allow_overlay) {
        return Err("ไม่ได้รับอนุญาตให้เรียกใช้งานคำสั่งนี้".to_string());
    }
    let is_release = !cfg!(debug_assertions);
    let url = webview
        .url()
        .map_err(|_| "ไม่สามารถยืนยันต้นทางของคำสั่งได้".to_string())?;
    if !is_allowed_webview_url(&url, is_release) {
        mark_tampered();
        return Err("ไม่ได้รับอนุญาตให้เรียกใช้งานจากต้นทางนี้".to_string());
    }
    Ok(())
}

pub fn verify_index_html_contents(html: &str, required_refs: &[&str]) -> bool {
    if html.trim().is_empty() || !html.contains("id=\"root\"") {
        return false;
    }
    required_refs.iter().all(|rel| html.contains(rel))
}

pub fn verify_embedded_dist_assets(app: &tauri::AppHandle) -> bool {
    if cfg!(debug_assertions) || generated::DIST_ASSET_MANIFEST.is_empty() {
        return true;
    }
    let resolver = app.asset_resolver();
    for (rel_path, expected_sha256) in generated::DIST_ASSET_MANIFEST {
        let Some(asset) = resolver.get((*rel_path).to_string()) else {
            return false;
        };
        let mut hasher = Sha256::new();
        hasher.update(&asset.bytes);
        let actual_sha256 = hex::encode(hasher.finalize());
        if &actual_sha256 != expected_sha256 {
            return false;
        }
    }
    let Some(index_asset) = resolver.get("index.html".to_string()) else {
        return false;
    };
    let Ok(index_html) = std::str::from_utf8(&index_asset.bytes) else {
        return false;
    };
    verify_index_html_contents(index_html, generated::INDEX_REQUIRED_REFS)
}

#[cfg(target_os = "windows")]
#[cfg_attr(debug_assertions, allow(dead_code))]
mod win_shield {
    use super::{is_re_module_name, is_re_tool_process};
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const INVALID_HANDLE_VALUE: *mut c_void = (-1isize) as *mut c_void;
    const PROCESS_DEBUG_PORT: u32 = 7;
    const PROCESS_DEBUG_FLAGS: u32 = 0x1F;
    const THREAD_HIDE_FROM_DEBUGGER: u32 = 0x11;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleA(lpModuleName: *const u8) -> *mut c_void;
        fn GetProcAddress(hModule: *mut c_void, lpProcName: *const u8) -> *mut c_void;
        fn GetCurrentProcess() -> isize;
        fn GetCurrentThread() -> *mut c_void;
        fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
        fn CloseHandle(hObject: *mut c_void) -> i32;
    }

    #[inline]
    fn current_process_handle() -> *mut c_void {
        unsafe { GetCurrentProcess() as *mut c_void }
    }

    fn resolve_proc(module: &[u8], func_obf: &[u8], key: u8) -> Option<*mut c_void> {
        let mut decoded: Vec<u8> = func_obf.iter().map(|b| b ^ key).collect();
        if decoded.last().copied() != Some(0) {
            decoded.push(0);
        }
        unsafe {
            let hmod = GetModuleHandleA(module.as_ptr());
            if hmod.is_null() {
                return None;
            }
            let addr = GetProcAddress(hmod, decoded.as_ptr());
            if addr.is_null() {
                None
            } else {
                Some(addr)
            }
        }
    }

    const K32: &[u8] = b"kernel32.dll\0";
    const NTDLL: &[u8] = b"ntdll.dll\0";
    const PROC_KEY: u8 = 0x5A;

    const fn xor_name<const N: usize>(raw: &[u8; N]) -> [u8; N] {
        let mut out = [0u8; N];
        let mut i = 0;
        while i < N {
            out[i] = raw[i] ^ PROC_KEY;
            i += 1;
        }
        out
    }

    const FN_IS_DEBUGGER_PRESENT: [u8; 18] = xor_name(b"IsDebuggerPresent\0");
    const FN_CHECK_REMOTE_DBG: [u8; 27] = xor_name(b"CheckRemoteDebuggerPresent\0");
    const FN_NT_QUERY_PROC: [u8; 26] = xor_name(b"NtQueryInformationProcess\0");
    const FN_NT_SET_THREAD: [u8; 23] = xor_name(b"NtSetInformationThread\0");
    const FN_CREATE_SNAP: [u8; 25] = xor_name(b"CreateToolhelp32Snapshot\0");
    const FN_PROC32_FIRST: [u8; 16] = xor_name(b"Process32FirstW\0");
    const FN_PROC32_NEXT: [u8; 15] = xor_name(b"Process32NextW\0");
    const FN_ENUM_MODS: [u8; 22] = xor_name(b"K32EnumProcessModules\0");
    const FN_MOD_NAME: [u8; 22] = xor_name(b"K32GetModuleBaseNameW\0");

    pub fn sanitize_dll_search_order() {
        let empty_wide: [u16; 1] = [0];
        unsafe {
            let _ = SetDllDirectoryW(empty_wide.as_ptr());
        }
    }

    pub fn hide_current_thread_from_debugger() {
        if let Some(addr) = resolve_proc(NTDLL, &FN_NT_SET_THREAD, PROC_KEY) {
            type FnType = unsafe extern "system" fn(*mut c_void, u32, *const c_void, u32) -> i32;
            let func: FnType = unsafe { std::mem::transmute(addr) };
            unsafe {
                let _ = func(GetCurrentThread(), THREAD_HIDE_FROM_DEBUGGER, null_mut(), 0);
            }
        }
    }

    pub fn detect_debugger_attached() -> bool {
        if let Some(addr) = resolve_proc(K32, &FN_IS_DEBUGGER_PRESENT, PROC_KEY) {
            type FnType = unsafe extern "system" fn() -> i32;
            let func: FnType = unsafe { std::mem::transmute(addr) };
            if unsafe { func() } != 0 {
                return true;
            }
        }

        if let Some(addr) = resolve_proc(K32, &FN_CHECK_REMOTE_DBG, PROC_KEY) {
            type FnType = unsafe extern "system" fn(*mut c_void, *mut i32) -> i32;
            let func: FnType = unsafe { std::mem::transmute(addr) };
            let mut present: i32 = 0;
            if unsafe { func(current_process_handle(), &mut present) } != 0 && present != 0 {
                return true;
            }
        }

        if let Some(addr) = resolve_proc(NTDLL, &FN_NT_QUERY_PROC, PROC_KEY) {
            type FnType = unsafe extern "system" fn(
                *mut c_void,
                u32,
                *mut c_void,
                u32,
                *mut u32,
            ) -> i32;
            let func: FnType = unsafe { std::mem::transmute(addr) };

            let mut debug_port: usize = 0;
            let status_port = unsafe {
                func(
                    current_process_handle(),
                    PROCESS_DEBUG_PORT,
                    (&mut debug_port as *mut usize).cast(),
                    size_of::<usize>() as u32,
                    null_mut(),
                )
            };
            if status_port == 0 && debug_port != 0 {
                return true;
            }

            let mut no_debug_inherit: u32 = 1;
            let status_flags = unsafe {
                func(
                    current_process_handle(),
                    PROCESS_DEBUG_FLAGS,
                    (&mut no_debug_inherit as *mut u32).cast(),
                    size_of::<u32>() as u32,
                    null_mut(),
                )
            };
            if status_flags == 0 && no_debug_inherit == 0 {
                return true;
            }
        }

        false
    }

    pub fn detect_re_modules() -> bool {
        let Some(enum_addr) = resolve_proc(K32, &FN_ENUM_MODS, PROC_KEY) else {
            return false;
        };
        let Some(name_addr) = resolve_proc(K32, &FN_MOD_NAME, PROC_KEY) else {
            return false;
        };
        type EnumFn = unsafe extern "system" fn(*mut c_void, *mut *mut c_void, u32, *mut u32) -> i32;
        type NameFn = unsafe extern "system" fn(*mut c_void, *mut c_void, *mut u16, u32) -> u32;
        let enum_mods: EnumFn = unsafe { std::mem::transmute(enum_addr) };
        let mod_name: NameFn = unsafe { std::mem::transmute(name_addr) };

        let proc_handle = current_process_handle();
        let mut modules: [*mut c_void; 512] = [null_mut(); 512];
        let mut needed: u32 = 0;
        let ok = unsafe {
            enum_mods(
                proc_handle,
                modules.as_mut_ptr(),
                size_of::<[*mut c_void; 512]>() as u32,
                &mut needed,
            )
        };
        if ok == 0 {
            return false;
        }
        let count = ((needed as usize) / size_of::<*mut c_void>()).min(modules.len());
        let mut buf = [0u16; 260];
        for &hmod in &modules[..count] {
            if hmod.is_null() {
                continue;
            }
            let len = unsafe { mod_name(proc_handle, hmod, buf.as_mut_ptr(), buf.len() as u32) };
            if len > 0 {
                let name = String::from_utf16_lossy(&buf[..len as usize]);
                if is_re_module_name(&name) {
                    return true;
                }
            }
        }
        false
    }

    pub fn detect_re_processes() -> bool {
        let Some(snap_addr) = resolve_proc(K32, &FN_CREATE_SNAP, PROC_KEY) else {
            return false;
        };
        let Some(first_addr) = resolve_proc(K32, &FN_PROC32_FIRST, PROC_KEY) else {
            return false;
        };
        let Some(next_addr) = resolve_proc(K32, &FN_PROC32_NEXT, PROC_KEY) else {
            return false;
        };

        type SnapFn = unsafe extern "system" fn(u32, u32) -> *mut c_void;
        type FirstFn = unsafe extern "system" fn(*mut c_void, *mut ProcessEntry32W) -> i32;
        type NextFn = unsafe extern "system" fn(*mut c_void, *mut ProcessEntry32W) -> i32;

        let create_snap: SnapFn = unsafe { std::mem::transmute(snap_addr) };
        let proc_first: FirstFn = unsafe { std::mem::transmute(first_addr) };
        let proc_next: NextFn = unsafe { std::mem::transmute(next_addr) };

        let snap = unsafe { create_snap(TH32CS_SNAPPROCESS, 0) };
        if snap.is_null() || snap == INVALID_HANDLE_VALUE {
            return false;
        }

        let mut entry: ProcessEntry32W = unsafe { zeroed() };
        entry.dw_size = size_of::<ProcessEntry32W>() as u32;
        let mut detected = false;
        if unsafe { proc_first(snap, &mut entry) } != 0 {
            loop {
                let end = entry
                    .sz_exe_file
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.sz_exe_file.len());
                let name = String::from_utf16_lossy(&entry.sz_exe_file[..end]);
                if is_re_tool_process(&name) {
                    detected = true;
                    break;
                }
                if unsafe { proc_next(snap, &mut entry) } == 0 {
                    break;
                }
            }
        }
        unsafe {
            let _ = CloseHandle(snap);
        }
        detected
    }
}

#[cfg(not(target_os = "windows"))]
mod win_shield {
    pub fn sanitize_dll_search_order() {}
    pub fn hide_current_thread_from_debugger() {}
    pub fn detect_debugger_attached() -> bool {
        false
    }
    pub fn detect_re_modules() -> bool {
        false
    }
    pub fn detect_re_processes() -> bool {
        false
    }
}

pub fn harden_process_startup() {
    win_shield::sanitize_dll_search_order();

    #[cfg(not(debug_assertions))]
    {
        for var in [
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
            "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
            "NODE_OPTIONS",
            "RUST_BACKTRACE",
            "TAURI_DEV_HOST",
        ] {
            std::env::remove_var(var);
        }

        if win_shield::detect_debugger_attached()
            || win_shield::detect_re_modules()
            || win_shield::detect_re_processes()
        {
            mark_tampered();
            std::process::exit(0);
        }
    }
}

pub fn hide_sensitive_thread() {
    #[cfg(not(debug_assertions))]
    win_shield::hide_current_thread_from_debugger();
}

pub fn start_integrity_watchdog() {
    #[cfg(not(debug_assertions))]
    {
        std::thread::spawn(|| {
            win_shield::hide_current_thread_from_debugger();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if is_tampered()
                    || win_shield::detect_debugger_attached()
                    || win_shield::detect_re_modules()
                    || win_shield::detect_re_processes()
                {
                    mark_tampered();
                    std::process::exit(0);
                }
            }
        });
    }
}

#[cfg(target_os = "windows")]
pub fn lock_webview_window(window: &tauri::WebviewWindow) {
    #[cfg(not(debug_assertions))]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings;
        let _ = window.with_webview(|webview| unsafe {
            let controller = webview.controller();
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(settings) = core.Settings() {
                    let settings: ICoreWebView2Settings = settings;
                    let _ = settings.SetAreDevToolsEnabled(false);
                    let _ = settings.SetAreDefaultContextMenusEnabled(false);
                    let _ = settings.SetIsStatusBarEnabled(false);
                    let _ = settings.SetIsBuiltInErrorPageEnabled(false);
                }
            }
        });
    }
    #[cfg(debug_assertions)]
    let _ = window;
}

#[cfg(not(target_os = "windows"))]
pub fn lock_webview_window(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obfuscated_constants_decode_to_expected_values() {
        assert_eq!(default_github_repo(), "Smallzoamz/5MLauncherEstra");
        assert_eq!(
            supabase_origin(),
            "https://hcynletyqztbbouwlcsg.supabase.co"
        );
        assert_eq!(discord_application_id(), "1545873345596096734");
        assert!(verify_brand_integrity(
            expected_product_name(),
            expected_identifier()
        ));
        assert!(!verify_brand_integrity(
            "Fake Cracked Launcher",
            expected_identifier()
        ));
    }

    #[test]
    fn re_tool_and_module_hash_matching_is_case_insensitive() {
        assert!(is_re_tool_process("x64dbg.exe"));
        assert!(is_re_tool_process("IDA64.EXE"));
        assert!(is_re_tool_process("Fiddler.exe"));
        assert!(is_re_tool_process("cheatengine-x86_64.exe"));
        assert!(!is_re_tool_process("FiveM.exe"));
        assert!(!is_re_tool_process("Discord.exe"));
        assert!(!is_re_tool_process("steam.exe"));

        assert!(is_re_module_name("Frida-Agent.dll"));
        assert!(is_re_module_name("ScyllaHide_x64.dll"));
        assert!(!is_re_module_name("kernel32.dll"));
    }

    #[test]
    fn webview_origin_and_label_validation() {
        let release_tauri = Url::parse("tauri://localhost/index.html").unwrap();
        let release_https = Url::parse("https://tauri.localhost/index.html").unwrap();
        let release_http = Url::parse("http://tauri.localhost/").unwrap();
        let local_dev = Url::parse("http://127.0.0.1:5199/").unwrap();
        let evil = Url::parse("https://evil.example/clone.html").unwrap();

        assert!(is_allowed_webview_url(&release_tauri, true));
        assert!(is_allowed_webview_url(&release_https, true));
        assert!(is_allowed_webview_url(&release_http, true));
        assert!(!is_allowed_webview_url(&local_dev, true));
        assert!(is_allowed_webview_url(&local_dev, false));
        assert!(!is_allowed_webview_url(&evil, true));
        assert!(!is_allowed_webview_url(&evil, false));

        assert!(is_allowed_webview_label("main", false));
        assert!(!is_allowed_webview_label("overlay", false));
        assert!(is_allowed_webview_label("overlay", true));
        assert!(!is_allowed_webview_label("untrusted", true));
    }

    #[test]
    fn index_html_verification_allows_tauri_reserialized_html_and_rejects_tampering() {
        let tauri_serialized_html = r#"<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><script type="module" crossorigin="" src="/assets/index-abc.js"></script><link rel="stylesheet" crossorigin="" href="/assets/index-def.css"></head><body><div id="root"></div></body></html>"#;
        let refs = ["assets/index-abc.js", "assets/index-def.css"];
        assert!(verify_index_html_contents(tauri_serialized_html, &refs));

        let tampered = tauri_serialized_html.replace("/assets/index-abc.js", "https://evil.test/payload.js");
        assert!(!verify_index_html_contents(&tampered, &refs));
        assert!(!verify_index_html_contents("<html><body></body></html>", &refs));
    }
}
