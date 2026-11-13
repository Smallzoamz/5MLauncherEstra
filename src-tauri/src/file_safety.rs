use std::fs;
use std::path::{Component, Path, PathBuf};

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

fn is_link_or_reparse(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            return true;
        }
    }
    false
}

/// Strip Windows extended-length prefix (`\\?\`) when comparing or displaying paths.
pub fn normalize_win_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

pub fn assert_within(root: &Path, target: &Path) -> Result<(), String> {
    let root_norm = normalize_win_path(root);
    let target_norm = normalize_win_path(target);
    if target_norm == root_norm {
        return Err("พาธอยู่นอกขอบเขตที่อนุญาต".into());
    }
    if target_norm.starts_with(&root_norm) {
        return Ok(());
    }
    Err("พาธอยู่นอกขอบเขตที่อนุญาต".into())
}

pub fn assert_no_links(absolute: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(p) => current.push(p.as_os_str()),
            Component::RootDir => current.push(component.as_os_str()),
            Component::Normal(part) => {
                current.push(part);
                match fs::symlink_metadata(&current) {
                    Ok(meta) => {
                        if is_link_or_reparse(&meta) {
                            return Err("ไม่ดำเนินการผ่าน symbolic link หรือ junction".into());
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                    Err(e) => return Err(format!("ตรวจสอบพาธไม่สำเร็จ: {e}")),
                }
            }
            Component::CurDir => {}
            Component::ParentDir => return Err("พาธไม่อนุญาตให้ใช้ ..".into()),
        }
    }
    Ok(())
}

pub fn assert_tree_no_links(directory: &Path) -> Result<(), std::io::Error> {
    let entries = fs::read_dir(directory)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)?;
        if is_link_or_reparse(&meta) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "พบ symbolic link/junction กรุณาจัดการด้วยตนเอง",
            ));
        }
        if meta.is_dir() {
            assert_tree_no_links(&path)?;
        }
    }
    Ok(())
}
