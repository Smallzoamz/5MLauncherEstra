use crate::file_safety::{assert_no_links, assert_within};
use crate::fivem::resolve_installation;
use crate::presence::{get_process_names, is_fivem_process};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceGroupPreview {
    pub category: String,
    pub label: String,
    pub files: usize,
    pub bytes: u64,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenancePreviewResult {
    pub groups: Vec<MaintenanceGroupPreview>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCleanResult {
    pub success: bool,
    pub deleted_files: usize,
    pub deleted_bytes: u64,
    pub steps: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanMaintenanceRequest {
    #[serde(default)]
    pub fivem_path: String,
    pub categories: Vec<String>,
}

struct PlannedTarget {
    relative: String,
    absolute: PathBuf,
    files: usize,
    bytes: u64,
}

struct PlannedGroup {
    category: String,
    label: String,
    targets: Vec<PlannedTarget>,
    files: usize,
    bytes: u64,
}

fn label_for(category: &str) -> Option<&'static str> {
    match category {
        "logs" => Some("Log"),
        "crashes" => Some("Crash reports"),
        "shaders" => Some("Shader / GPU cache"),
        _ => None,
    }
}

pub fn validate_categories(categories: &[String]) -> Result<(), String> {
    if categories.is_empty() || categories.len() > 3 {
        return Err("กรุณาเลือกประเภท Log, Crash หรือ Shader ที่ต้องการล้าง".into());
    }
    let mut seen = HashSet::new();
    for c in categories {
        if label_for(c).is_none() || !seen.insert(c.as_str()) {
            return Err("กรุณาเลือกประเภท Log, Crash หรือ Shader ที่ต้องการล้าง".into());
        }
    }
    Ok(())
}

fn measure_target(target: &Path) -> Result<(bool, usize, u64), String> {
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut entries = 0usize;

    fn visit(
        path: &Path,
        files: &mut usize,
        bytes: &mut u64,
        entries: &mut usize,
    ) -> Result<bool, String> {
        *entries += 1;
        if *entries > 50_000 {
            return Err("มีไฟล์มากเกินขอบเขตตรวจสอบ กรุณาจัดการโฟลเดอร์นี้ด้วยตนเอง".into());
        }
        let meta = match fs::symlink_metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(format!("ตรวจสอบไฟล์ไม่สำเร็จ: {e}")),
        };
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_type().is_symlink() || (meta.file_attributes() & 0x0400) != 0 {
                return Err("พบ symbolic link/junction จึงไม่ล้างไฟล์".into());
            }
        }
        #[cfg(not(windows))]
        if meta.file_type().is_symlink() {
            return Err("พบ symbolic link/junction จึงไม่ล้างไฟล์".into());
        }
        if meta.is_dir() {
            for entry in fs::read_dir(path).map_err(|e| format!("อ่านโฟลเดอร์ไม่สำเร็จ: {e}"))? {
                let entry = entry.map_err(|e| format!("อ่านไฟล์ไม่สำเร็จ: {e}"))?;
                visit(&entry.path(), files, bytes, entries)?;
            }
        } else if meta.is_file() {
            *files += 1;
            *bytes += meta.len();
        } else {
            return Err("ชนิดไฟล์ไม่รองรับการล้าง".into());
        }
        Ok(true)
    }

    let exists = visit(target, &mut files, &mut bytes, &mut entries)?;
    Ok((exists, files, bytes))
}

fn plan(fivem_path: &str, categories: &[String]) -> Result<Vec<PlannedGroup>, String> {
    let installation = resolve_installation(fivem_path)?;
    assert_no_links(&installation.app)?;

    let mut shader_relatives = vec![
        "data/cache/shaders".to_string(),
        "data/cache/shader-cache".to_string(),
    ];
    let nui = installation.app.join("data").join("nui-storage");
    if categories.iter().any(|c| c == "shaders") {
        assert_no_links(&nui)?;
        let mut contexts = vec![String::new()];
        if let Ok(entries) = fs::read_dir(&nui) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_context = name.starts_with("context-server_")
                    && name["context-server_".len()..]
                        .bytes()
                        .all(|b| b.is_ascii_digit())
                    && name.len() > "context-server_".len();
                if is_context || name == "Default" {
                    let meta = fs::symlink_metadata(entry.path())
                        .map_err(|_| "พบ junction ใน Shader cache".to_string())?;
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::MetadataExt;
                        if meta.file_type().is_symlink() || (meta.file_attributes() & 0x0400) != 0 {
                            return Err("พบ junction ใน Shader cache".into());
                        }
                    }
                    if meta.is_dir() {
                        contexts.push(name);
                    }
                }
            }
        }
        for context in contexts {
            for name in [
                "GPUCache",
                "ShaderCache",
                "GrShaderCache",
                "DawnGraphiteCache",
                "GraphiteDawnCache",
            ] {
                let rel = if context.is_empty() {
                    format!("data/nui-storage/{name}")
                } else {
                    format!("data/nui-storage/{context}/{name}")
                };
                shader_relatives.push(rel);
            }
        }
    }

    let mut result = Vec::new();
    for category in categories {
        let label = label_for(category).unwrap().to_string();
        let relatives: Vec<String> = match category.as_str() {
            "logs" => vec!["logs".into()],
            "crashes" => vec!["crashes".into()],
            "shaders" => shader_relatives.clone(),
            _ => vec![],
        };
        let mut targets = Vec::new();
        for relative in relatives {
            let absolute = installation.app.join(&relative);
            assert_within(&installation.app, &absolute)?;
            assert_no_links(&absolute)?;
            let (exists, files, bytes) = measure_target(&absolute)?;
            if exists {
                targets.push(PlannedTarget {
                    relative,
                    absolute,
                    files,
                    bytes,
                });
            }
        }
        let files = targets.iter().map(|t| t.files).sum();
        let bytes = targets.iter().map(|t| t.bytes).sum();
        result.push(PlannedGroup {
            category: category.clone(),
            label,
            targets,
            files,
            bytes,
        });
    }
    Ok(result)
}

pub fn preview_maintenance(fivem_path: &str) -> Result<MaintenancePreviewResult, String> {
    let cats = vec!["logs".into(), "crashes".into(), "shaders".into()];
    let groups = plan(fivem_path, &cats)?;
    Ok(MaintenancePreviewResult {
        groups: groups
            .into_iter()
            .map(|g| MaintenanceGroupPreview {
                category: g.category,
                label: g.label,
                files: g.files,
                bytes: g.bytes,
                paths: g.targets.into_iter().map(|t| t.relative).collect(),
            })
            .collect(),
    })
}

pub fn clean_maintenance(req: CleanMaintenanceRequest) -> Result<MaintenanceCleanResult, String> {
    validate_categories(&req.categories)?;
    let check_stopped = || -> Result<(), String> {
        let names = get_process_names()?;
        if names.iter().any(|n| is_fivem_process(n)) {
            return Err("กรุณาปิด FiveM ทุกหน้าต่างก่อนล้าง Log, Crash หรือ Shader".into());
        }
        Ok(())
    };
    check_stopped()?;
    let groups = plan(&req.fivem_path, &req.categories)?;
    check_stopped()?;

    let mut steps = Vec::new();
    let mut errors = Vec::new();
    let mut deleted_files = 0usize;
    let mut deleted_bytes = 0u64;

    for group in groups {
        if group.targets.is_empty() {
            steps.push(format!("{}: ไม่มีไฟล์ให้ล้าง", group.label));
            continue;
        }
        for target in group.targets {
            if let Err(e) = assert_no_links(&target.absolute) {
                errors.push(format!("{}: {e}", target.relative));
                continue;
            }
            match fs::remove_dir_all(&target.absolute) {
                Ok(()) => {
                    deleted_files += target.files;
                    deleted_bytes += target.bytes;
                    steps.push(format!("{}: ล้างแล้ว ({} ไฟล์)", target.relative, target.files));
                }
                Err(e) => errors.push(format!("{}: {e}", target.relative)),
            }
        }
    }

    Ok(MaintenanceCleanResult {
        success: errors.is_empty(),
        deleted_files,
        deleted_bytes,
        steps,
        error: if errors.is_empty() {
            None
        } else {
            Some(errors.join("; "))
        },
    })
}
