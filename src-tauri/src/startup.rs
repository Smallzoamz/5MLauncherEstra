use crate::file_safety::normalize_win_path;
use serde::Serialize;
use std::path::Path;

pub const AUTOSTART_ARG: &str = "--autostart";
#[cfg(target_os = "windows")]
const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const RUN_VALUE_NAME: &str = "Estra FiveM Launcher";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupSettingsState {
    pub enabled: bool,
    pub low_priority: bool,
    pub autostart_launched: bool,
}

pub fn is_autostart_arg(args: &[String]) -> bool {
    args.iter().any(|arg| arg == AUTOSTART_ARG)
}

pub fn launched_from_autostart() -> bool {
    let args: Vec<String> = std::env::args().collect();
    is_autostart_arg(&args)
}

pub fn build_autostart_command(exe_path: &Path) -> Result<String, String> {
    let normalized = normalize_win_path(exe_path);
    let raw = normalized.to_string_lossy().trim().to_string();
    if raw.is_empty() || raw.contains('"') || raw.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err("ไม่สามารถระบุพาธไฟล์โปรแกรมสำหรับ Run on Windows Start ได้".to_string());
    }
    Ok(format!("\"{raw}\" {AUTOSTART_ARG}"))
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::{build_autostart_command, RUN_SUBKEY, RUN_VALUE_NAME};
    use std::io::ErrorKind;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    const IDLE_PRIORITY_CLASS: u32 = 0x0000_0040;
    const NORMAL_PRIORITY_CLASS: u32 = 0x0000_0020;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn SetPriorityClass(hProcess: isize, dwPriorityClass: u32) -> i32;
        fn GetPriorityClass(hProcess: isize) -> u32;
    }

    pub fn apply_process_priority(low: bool) -> Result<(), String> {
        let class = if low {
            IDLE_PRIORITY_CLASS
        } else {
            NORMAL_PRIORITY_CLASS
        };
        let ok = unsafe { SetPriorityClass(GetCurrentProcess(), class) };
        if ok == 0 {
            return Err("ไม่สามารถปรับระดับ Process Priority ของโปรแกรมได้".to_string());
        }
        Ok(())
    }

    pub fn is_low_priority() -> bool {
        let current = unsafe { GetPriorityClass(GetCurrentProcess()) };
        current == IDLE_PRIORITY_CLASS
    }

    pub fn is_windows_startup_enabled() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(key) = hkcu.open_subkey_with_flags(RUN_SUBKEY, KEY_READ) else {
            return false;
        };
        key.get_value::<String, _>(RUN_VALUE_NAME)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    }

    pub fn set_windows_startup_enabled(enabled: bool) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            let exe = std::env::current_exe()
                .map_err(|e| format!("ไม่พบพาธไฟล์โปรแกรมปัจจุบัน: {e}"))?;
            let command = build_autostart_command(&exe)?;
            let (key, _) = hkcu
                .create_subkey(RUN_SUBKEY)
                .map_err(|e| format!("ไม่สามารถเปิด Windows Startup Registry ได้: {e}"))?;
            key.set_value(RUN_VALUE_NAME, &command)
                .map_err(|e| format!("ไม่สามารถบันทึก Run on Windows Start ได้: {e}"))?;
            return Ok(());
        }

        match hkcu.open_subkey_with_flags(RUN_SUBKEY, KEY_WRITE) {
            Ok(key) => match key.delete_value(RUN_VALUE_NAME) {
                Ok(()) => Ok(()),
                Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
                Err(err) => Err(format!("ไม่สามารถยกเลิก Run on Windows Start ได้: {err}")),
            },
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
            Err(err) => Err(format!("ไม่สามารถเปิด Windows Startup Registry ได้: {err}")),
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_impl {
    pub fn apply_process_priority(_low: bool) -> Result<(), String> {
        Ok(())
    }

    pub fn is_low_priority() -> bool {
        false
    }

    pub fn is_windows_startup_enabled() -> bool {
        false
    }

    pub fn set_windows_startup_enabled(_enabled: bool) -> Result<(), String> {
        Err("รองรับ Run on Windows Start เฉพาะบน Windows เท่านั้น".to_string())
    }
}

pub use win_impl::{
    apply_process_priority, is_low_priority, is_windows_startup_enabled,
    set_windows_startup_enabled,
};

pub fn get_startup_settings() -> StartupSettingsState {
    StartupSettingsState {
        enabled: is_windows_startup_enabled(),
        low_priority: is_low_priority(),
        autostart_launched: launched_from_autostart(),
    }
}

pub fn set_startup_settings(enabled: bool) -> Result<StartupSettingsState, String> {
    set_windows_startup_enabled(enabled)?;
    apply_process_priority(enabled)?;
    Ok(get_startup_settings())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn detects_autostart_flag_exact_match() {
        assert!(is_autostart_arg(&[
            "Estra.exe".to_string(),
            "--autostart".to_string()
        ]));
        assert!(!is_autostart_arg(&[
            "Estra.exe".to_string(),
            "--other".to_string()
        ]));
        assert!(!is_autostart_arg(&[]));
    }

    #[test]
    fn builds_clean_quoted_autostart_command() {
        let cmd = build_autostart_command(&PathBuf::from(r"\\?\D:\Apps\Estra FiveM Launcher.exe"))
            .unwrap();
        assert_eq!(cmd, r#""D:\Apps\Estra FiveM Launcher.exe" --autostart"#);
        assert!(build_autostart_command(&PathBuf::from(r#"C:\bad"path.exe"#)).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn toggles_windows_process_low_and_normal_priority() {
        apply_process_priority(true).unwrap();
        assert!(is_low_priority());
        apply_process_priority(false).unwrap();
        assert!(!is_low_priority());
    }
}
