use crate::file_safety::{assert_no_links, normalize_win_path};
use crate::presence::{get_process_names, is_fivem_process};
use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const BACKUP_FILE_NAME: &str = "settings.xml.estra-original.bak";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub gpu_name: String,
    pub vram_mb: u64,
    pub shared_mem_mb: u64,
    pub ram_gb: u32,
    pub cpu_cores: u32,
    pub is_integrated: bool,
    pub tier: String, // "potato" | "entry" | "mid" | "high"
    pub tier_label: String,
    pub tier_summary: String,
    pub recommended_preset_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePerfPresetInfo {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub badge: String,
    pub recommended: bool,
    pub vram_target: String,
    pub fps_score: u8,    // 1..=5
    pub visual_score: u8, // 1..=5
    pub highlights: Vec<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CurrentGraphicsSummary {
    pub resolution: String,
    pub window_mode: String,
    pub texture: String,
    pub shader: String,
    pub shadow: String,
    pub grass: String,
    pub post_fx: String,
    pub reflection: String,
    pub msaa: String,
    pub fxaa: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePerfPresetsState {
    pub found: bool,
    pub settings_path: String,
    pub has_backup: bool,
    pub active_preset_id: String, // preset id or "custom" or "none"
    pub hardware: HardwareProfile,
    pub current: CurrentGraphicsSummary,
    pub presets: Vec<GamePerfPresetInfo>,
}

struct AdaptivePresetSpec {
    id: &'static str,
    name: &'static str,
    subtitle: &'static str,
    badge: &'static str,
    recommended: bool,
    vram_target: &'static str,
    fps_score: u8,
    visual_score: u8,
    highlights: &'static [&'static str],
    values: &'static [(&'static str, &'static str)],
}

#[cfg(windows)]
#[repr(C)]
struct MemoryStatusEx {
    dw_length: u32,
    dw_memory_load: u32,
    ull_total_phys: u64,
    ull_avail_phys: u64,
    ull_total_page_file: u64,
    ull_avail_page_file: u64,
    ull_total_virtual: u64,
    ull_avail_virtual: u64,
    ull_avail_extended_virtual: u64,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GlobalMemoryStatusEx(lp_buffer: *mut MemoryStatusEx) -> i32;
}

#[cfg(windows)]
fn detect_total_ram_gb() -> u32 {
    let mut mem = MemoryStatusEx {
        dw_length: std::mem::size_of::<MemoryStatusEx>() as u32,
        dw_memory_load: 0,
        ull_total_phys: 0,
        ull_avail_phys: 0,
        ull_total_page_file: 0,
        ull_avail_page_file: 0,
        ull_total_virtual: 0,
        ull_avail_virtual: 0,
        ull_avail_extended_virtual: 0,
    };
    let ok = unsafe { GlobalMemoryStatusEx(&mut mem) };
    if ok != 0 && mem.ull_total_phys > 0 {
        ((mem.ull_total_phys as f64) / (1024.0 * 1024.0 * 1024.0))
            .round()
            .clamp(1.0, 1024.0) as u32
    } else {
        8
    }
}

#[cfg(not(windows))]
fn detect_total_ram_gb() -> u32 {
    16
}

fn looks_like_integrated_gpu(name: &str, vram_mb: u64) -> bool {
    let lower = name.to_ascii_lowercase();
    if vram_mb < 1536 {
        return true;
    }
    let integrated_keywords = [
        "intel(r) uhd",
        "intel(r) hd graphics",
        "intel(r) iris",
        "intel(r) graphics",
        "radeon(tm) graphics",
        "amd radeon graphics",
        "microsoft basic",
    ];
    integrated_keywords.iter().any(|kw| lower.contains(kw)) && vram_mb < 3584
}

#[cfg(windows)]
fn detect_primary_gpu() -> (String, u64, u64, bool) {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };

    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return ("Unknown GPU".into(), 0, 0, true);
    };

    let mut best: Option<(String, u64, u64, bool)> = None;
    let mut idx = 0u32;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(idx) } {
        idx += 1;
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if (desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32)) != 0 {
            continue;
        }
        let end = desc
            .Description
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..end])
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let vram_mb = (desc.DedicatedVideoMemory as u64) / (1024 * 1024);
        let shared_mb = (desc.SharedSystemMemory as u64) / (1024 * 1024);
        let integrated = looks_like_integrated_gpu(&name, vram_mb);

        let replace = match &best {
            None => true,
            Some((_, best_vram, best_shared, best_igpu)) => {
                // Prefer discrete GPU with larger dedicated VRAM; fallback to larger shared memory
                if *best_igpu && !integrated && vram_mb >= 1536 {
                    true
                } else if !*best_igpu && integrated {
                    false
                } else if vram_mb != *best_vram {
                    vram_mb > *best_vram
                } else {
                    shared_mb > *best_shared
                }
            }
        };
        if replace {
            best = Some((name, vram_mb, shared_mb, integrated));
        }
    }

    best.unwrap_or_else(|| ("Unknown GPU".into(), 0, 0, true))
}

#[cfg(not(windows))]
fn detect_primary_gpu() -> (String, u64, u64, bool) {
    ("Generic GPU".into(), 6144, 8192, false)
}

/// Classifies PC hardware into one of 4 adaptive tiers:
/// - `potato`: iGPU, VRAM < 3.2GB, or RAM <= 8GB
/// - `entry`:  VRAM ~4GB (3.2–5.7GB), RAM <= 12GB, or CPU <= 4 threads
/// - `mid`:    VRAM ~6–9GB with >= 16GB RAM (or high VRAM with < 16GB RAM)
/// - `high`:   VRAM >= 10GB, RAM >= 16GB, CPU >= 8 threads
pub fn classify_hardware_tier(
    vram_mb: u64,
    ram_gb: u32,
    cpu_cores: u32,
    is_integrated: bool,
) -> (&'static str, &'static str, &'static str, &'static str) {
    if vram_mb < 3200 || ram_gb <= 8 || (is_integrated && vram_mb < 4096) {
        (
            "potato",
            "สเปกประหยัด · Ultra-Safe",
            "ปรับเพดานทั้ง 3 พรีเซ็ตลงเป็นพิเศษสำหรับเครื่อง VRAM/RAM จำกัด — ปิดเงาและลดโหลดโมเดลในโหมด Ultra FPS เพื่อให้เล่นเมืองคนเยอะได้จริงโดยไม่ค้างหรือเด้ง",
            "ultra-fps",
        )
    } else if vram_mb < 5800 || ram_gb <= 12 || cpu_cores <= 4 {
        (
            "entry",
            "สเปกเริ่มต้น · Entry",
            "จูนค่าพรีเซ็ตให้พอดีกับการ์ดจอ 4GB / RAM จำกัด — ล็อกเพดาน Texture/Shadow ไม่ให้ล้น VRAM และตัด Grass/MSAA ที่กินเฟรมหนักออก",
            "balanced-rp",
        )
    } else if vram_mb < 10000 || ram_gb < 16 || cpu_cores < 8 {
        (
            "mid",
            "สเปกระดับกลาง · Mid-Range",
            "ปรับสมดุลทั้ง 3 พรีเซ็ตสำหรับการ์ดจอ 6–8GB — ดันเฟรมนิ่งในโหมดไฟต์ และเปิด Texture/Shader ระดับ High–Very High ได้ลื่นในโหมด RP",
            "balanced-rp",
        )
    } else {
        (
            "high",
            "สเปกระดับสูง · High-End",
            "เครื่องพร้อมรับกราฟิกเต็มประสิทธิภาพ — โหมด Ultra FPS คงความคมชัด Texture High พร้อมเฟรมสูงสุด และโหมดภาพสวยปลดล็อก Very High + MSAA 2x + เงาเต็มรูปแบบ",
            "balanced-rp",
        )
    }
}

pub fn detect_hardware_profile() -> HardwareProfile {
    static CACHED: OnceLock<HardwareProfile> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let (gpu_name, vram_mb, shared_mem_mb, is_integrated) = detect_primary_gpu();
            let ram_gb = detect_total_ram_gb();
            let cpu_cores = std::thread::available_parallelism()
                .map(|n| n.get() as u32)
                .unwrap_or(4);
            let (tier, tier_label, tier_summary, rec_id) =
                classify_hardware_tier(vram_mb, ram_gb, cpu_cores, is_integrated);
            HardwareProfile {
                gpu_name,
                vram_mb,
                shared_mem_mb,
                ram_gb,
                cpu_cores,
                is_integrated,
                tier: tier.into(),
                tier_label: tier_label.into(),
                tier_summary: tier_summary.into(),
                recommended_preset_id: rec_id.into(),
            }
        })
        .clone()
}

fn build_presets_for_tier(tier: &str) -> &'static [AdaptivePresetSpec] {
    match tier {
        "potato" => POTATO_PRESETS,
        "entry" => ENTRY_PRESETS,
        "mid" => MID_PRESETS,
        "high" => HIGH_PRESETS,
        _ => ENTRY_PRESETS,
    }
}

// ============================================================================
// Tier 1: POTATO (iGPU / VRAM < 3.2GB / RAM <= 8GB)
// ============================================================================
const POTATO_PRESETS: &[AdaptivePresetSpec] = &[
    AdaptivePresetSpec {
        id: "ultra-fps",
        name: "Ultra FPS · เอาตัวรอดเครื่องสเปกประหยัด",
        subtitle: "ลดภาระการ์ดจอและ RAM ขั้นสุด ปิดเงา ลดระยะโหลด LOD และประชากรเป็น 0 เพื่อให้เข้าเมืองคนเยอะได้ลื่นที่สุดเท่าที่เครื่องไหว",
        badge: "แนะนำสำหรับเครื่องนี้",
        recommended: true,
        vram_target: "~1.2–1.8 GB",
        fps_score: 5,
        visual_score: 1,
        highlights: &[
            "ปิดเงาทั้งหมด (Shadow: Off) · Texture/Shader: Normal",
            "LodScale / Distance / CityDensity = 0.0 ลดอาการแมพหายและเกมเด้ง",
            "ปิด MSAA, FXAA, AF, Grass, PostFX, SSAO, Fog Volumes",
        ],
        values: &[
            ("TextureQuality", "0"),
            ("ShaderQuality", "0"),
            ("ShadowQuality", "0"),
            ("ReflectionQuality", "0"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "0"),
            ("WaterQuality", "0"),
            ("ParticleQuality", "0"),
            ("GrassQuality", "0"),
            ("PostFX", "0"),
            ("Shadow_SoftShadows", "0"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "0.000000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "false"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "0"),
            ("LodScale", "0.000000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.000000"),
            ("CityDensity", "0.000000"),
            ("PedVarietyMultiplier", "0.000000"),
            ("VehicleVarietyMultiplier", "0.000000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "false"),
        ],
    },
    AdaptivePresetSpec {
        id: "balanced-rp",
        name: "Balanced RP · ลื่นพอดีสำหรับสเปกประหยัด",
        subtitle: "ยังเซฟ VRAM เข้มงวดแต่เปิดเงาเบาๆ + FXAA และระยะมองเห็นพออ่านป้าย/แต่งตัวในเมือง RP ได้ชัดขึ้น",
        badge: "สมดุล RP",
        recommended: false,
        vram_target: "~1.6–2.3 GB",
        fps_score: 4,
        visual_score: 2,
        highlights: &[
            "Texture / Shader / Shadow: Normal (มีเงาพื้นฐานไม่ลอย)",
            "เปิด FXAA + AF 2x ลดขอบหยักแบบแทบไม่กินเฟรม",
            "LodScale 0.3 · Distance 25% · ปิด Grass/PostFX/MSAA",
        ],
        values: &[
            ("TextureQuality", "0"),
            ("ShaderQuality", "0"),
            ("ShadowQuality", "1"),
            ("ReflectionQuality", "0"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "0"),
            ("WaterQuality", "0"),
            ("ParticleQuality", "0"),
            ("GrassQuality", "0"),
            ("PostFX", "0"),
            ("Shadow_SoftShadows", "0"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "0.500000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "2"),
            ("LodScale", "0.300000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.250000"),
            ("CityDensity", "0.200000"),
            ("PedVarietyMultiplier", "0.250000"),
            ("VehicleVarietyMultiplier", "0.250000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "false"),
        ],
    },
    AdaptivePresetSpec {
        id: "high-visual",
        name: "Best Safe Visual · ภาพชัดสุดที่เครื่องนี้ไหว",
        subtitle: "ขยับ Texture เป็น High ให้เสื้อผ้า/รถคมขึ้น แต่ล็อกเพดานปิด MSAA, Grass, PostFX สูง เพื่อกัน VRAM เต็มและเกมเด้ง",
        badge: "ชัดสุดแบบปลอดภัย",
        recommended: false,
        vram_target: "~2.2–2.9 GB",
        fps_score: 3,
        visual_score: 3,
        highlights: &[
            "Texture & Water: High · Shader & Shadow: Normal",
            "FXAA + Anisotropic 4x · ระยะมองเห็น 45%",
            "ล็อกปิด MSAA / Grass / PostFX High กัน ERR_GFX_D3D_INIT",
        ],
        values: &[
            ("TextureQuality", "1"),
            ("ShaderQuality", "0"),
            ("ShadowQuality", "1"),
            ("ReflectionQuality", "0"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "0"),
            ("WaterQuality", "1"),
            ("ParticleQuality", "0"),
            ("GrassQuality", "0"),
            ("PostFX", "0"),
            ("Shadow_SoftShadows", "0"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "0.750000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "4"),
            ("LodScale", "0.500000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.450000"),
            ("CityDensity", "0.350000"),
            ("PedVarietyMultiplier", "0.400000"),
            ("VehicleVarietyMultiplier", "0.400000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "false"),
        ],
    },
];

// ============================================================================
// Tier 2: ENTRY (VRAM ~4GB / RAM 8-12GB / <= 4 threads)
// ============================================================================
const ENTRY_PRESETS: &[AdaptivePresetSpec] = &[
    AdaptivePresetSpec {
        id: "ultra-fps",
        name: "Ultra FPS · ลื่นสุดสำหรับสเปกเริ่มต้น",
        subtitle: "ปิดเงาและลดระยะโหลดลงมาก ดันเฟรมนิ่งช่วงยิงไฟต์หรือรวมพลโดยไม่เปลือง VRAM 4GB",
        badge: "FPS สูงสุด",
        recommended: false,
        vram_target: "~1.5–2.1 GB",
        fps_score: 5,
        visual_score: 2,
        highlights: &[
            "Shadow: Off · Texture / Shader / Reflection: Normal",
            "LodScale 0.2 · Distance 20% · CityDensity 15%",
            "ปิด MSAA, FXAA, AF, Grass, PostFX, SSAO",
        ],
        values: &[
            ("TextureQuality", "0"),
            ("ShaderQuality", "0"),
            ("ShadowQuality", "0"),
            ("ReflectionQuality", "0"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "0"),
            ("WaterQuality", "0"),
            ("ParticleQuality", "0"),
            ("GrassQuality", "0"),
            ("PostFX", "0"),
            ("Shadow_SoftShadows", "0"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "0.000000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "false"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "0"),
            ("LodScale", "0.200000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.200000"),
            ("CityDensity", "0.150000"),
            ("PedVarietyMultiplier", "0.200000"),
            ("VehicleVarietyMultiplier", "0.200000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "false"),
        ],
    },
    AdaptivePresetSpec {
        id: "balanced-rp",
        name: "Balanced RP · สมดุลสำหรับเครื่อง 4GB",
        subtitle: "จุดลงตัวที่สุดสำหรับสเปกเริ่มต้น — ภาพเสื้อผ้า/รถคมระดับ High แต่ตัด Shader/PostFX หนักออกเพื่อเฟรมลื่นตลอดเกม",
        badge: "แนะนำสำหรับเครื่องนี้",
        recommended: true,
        vram_target: "~2.3–3.0 GB",
        fps_score: 4,
        visual_score: 3,
        highlights: &[
            "Texture & Water: High · Shader & Shadow: Normal",
            "FXAA + Anisotropic 4x · Distance 50%",
            "ปิด MSAA, Grass, PostFX สูง และ SSAO กันเฟรมดรอป",
        ],
        values: &[
            ("TextureQuality", "1"),
            ("ShaderQuality", "0"),
            ("ShadowQuality", "1"),
            ("ReflectionQuality", "0"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "0"),
            ("WaterQuality", "1"),
            ("ParticleQuality", "0"),
            ("GrassQuality", "0"),
            ("PostFX", "0"),
            ("Shadow_SoftShadows", "0"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "0.800000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "4"),
            ("LodScale", "0.600000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.500000"),
            ("CityDensity", "0.400000"),
            ("PedVarietyMultiplier", "0.400000"),
            ("VehicleVarietyMultiplier", "0.400000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "false"),
        ],
    },
    AdaptivePresetSpec {
        id: "high-visual",
        name: "High Quality · ภาพสวยสุดที่การ์ดจอ 4GB ไหว",
        subtitle: "เปิด High เกือบทุกหมวดพร้อมแสง PostFX และ SSAO ให้ภาพสวยถ่ายรูปได้ โดยไม่ดัน MSAA จน VRAM ล้น",
        badge: "ภาพสวยสุดที่ไหว",
        recommended: false,
        vram_target: "~3.1–3.8 GB",
        fps_score: 3,
        visual_score: 4,
        highlights: &[
            "Texture / Shader / Shadow / Reflection / PostFX: High",
            "FXAA + Anisotropic 8x + SSAO Normal · Distance 75%",
            "คุม VRAM ให้อยู่ในกรอบ 4GB (ปิด MSAA & Grass High)",
        ],
        values: &[
            ("TextureQuality", "1"),
            ("ShaderQuality", "1"),
            ("ShadowQuality", "2"),
            ("ReflectionQuality", "1"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "1"),
            ("WaterQuality", "1"),
            ("ParticleQuality", "1"),
            ("GrassQuality", "0"),
            ("PostFX", "1"),
            ("Shadow_SoftShadows", "1"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "1.000000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "8"),
            ("LodScale", "0.800000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.750000"),
            ("CityDensity", "0.600000"),
            ("PedVarietyMultiplier", "0.600000"),
            ("VehicleVarietyMultiplier", "0.600000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "true"),
        ],
    },
];

// ============================================================================
// Tier 3: MID (VRAM 6-9GB / RAM 16GB+)
// ============================================================================
const MID_PRESETS: &[AdaptivePresetSpec] = &[
    AdaptivePresetSpec {
        id: "ultra-fps",
        name: "Ultra FPS · สายไฟต์ / วอร์ (สเปกกลาง)",
        subtitle: "รีดเฟรมเรตสูงสุดตอนยิงหรือจุดคนเยอะ แต่ยังเหลือระยะมองเห็นพอเหมาะและ AF 4x ไม่ให้พื้นถนนเบลอ",
        badge: "FPS สูงสุด",
        recommended: false,
        vram_target: "~2.0–2.8 GB",
        fps_score: 5,
        visual_score: 2,
        highlights: &[
            "Shadow: Off · Texture / Shader / Reflection: Normal",
            "Anisotropic 4x · Distance 45% · LodScale 0.5",
            "ปิด MSAA, FXAA, Grass, PostFX, SSAO, Motion Blur",
        ],
        values: &[
            ("TextureQuality", "0"),
            ("ShaderQuality", "0"),
            ("ShadowQuality", "0"),
            ("ReflectionQuality", "0"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "0"),
            ("WaterQuality", "0"),
            ("ParticleQuality", "0"),
            ("GrassQuality", "0"),
            ("PostFX", "0"),
            ("Shadow_SoftShadows", "0"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "0.000000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "false"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "4"),
            ("LodScale", "0.500000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.450000"),
            ("CityDensity", "0.350000"),
            ("PedVarietyMultiplier", "0.400000"),
            ("VehicleVarietyMultiplier", "0.400000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "false"),
        ],
    },
    AdaptivePresetSpec {
        id: "balanced-rp",
        name: "Balanced RP · ลื่นและคมชัด (แนะนำ)",
        subtitle: "ค่าสมดุลยอดนิยมสำหรับเครื่อง VRAM 6–8GB — ภาพคมชัด สีสวย เล่นเมืองคนเยอะ 200+ คนได้ลื่นไม่กระตุก",
        badge: "แนะนำสำหรับเครื่องนี้",
        recommended: true,
        vram_target: "~3.2–4.2 GB",
        fps_score: 4,
        visual_score: 4,
        highlights: &[
            "Texture / Shader / Shadow / Reflection / PostFX: High",
            "FXAA + Anisotropic 8x + SSAO Normal · Distance 75%",
            "Grass: Normal · ปิด MSAA & Motion Blur เพื่อเฟรมนิ่ง",
        ],
        values: &[
            ("TextureQuality", "1"),
            ("ShaderQuality", "1"),
            ("ShadowQuality", "2"),
            ("ReflectionQuality", "1"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "1"),
            ("WaterQuality", "1"),
            ("ParticleQuality", "1"),
            ("GrassQuality", "0"),
            ("PostFX", "1"),
            ("Shadow_SoftShadows", "1"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "1.000000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "8"),
            ("LodScale", "0.800000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.750000"),
            ("CityDensity", "0.650000"),
            ("PedVarietyMultiplier", "0.650000"),
            ("VehicleVarietyMultiplier", "0.650000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "true"),
        ],
    },
    AdaptivePresetSpec {
        id: "high-visual",
        name: "High Visual · ภาพสวยถ่ายรูป / สตรีม",
        subtitle: "ปลดล็อก Texture, Shader, Reflection, PostFX ระดับ Very High เต็มความสามารถการ์ดจอ 6–8GB โดยไม่เปิด MSAA หนักเกินจำเป็น",
        badge: "ภาพสวยสุดที่ไหว",
        recommended: false,
        vram_target: "~4.8–6.0 GB",
        fps_score: 3,
        visual_score: 5,
        highlights: &[
            "Texture / Shader / Reflection / Water / PostFX: Very High",
            "Shadow & Grass: High · Anisotropic 16x + FXAA",
            "ปิด MSAA & DoF เพื่อคงเฟรมสตรีมนิ่งและภาพคมไม่เบลอ",
        ],
        values: &[
            ("TextureQuality", "2"),
            ("ShaderQuality", "2"),
            ("ShadowQuality", "2"),
            ("ReflectionQuality", "2"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "1"),
            ("WaterQuality", "2"),
            ("ParticleQuality", "2"),
            ("GrassQuality", "1"),
            ("PostFX", "2"),
            ("Shadow_SoftShadows", "2"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "1.000000"),
            ("Tessellation", "1"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "16"),
            ("LodScale", "1.000000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.950000"),
            ("CityDensity", "0.850000"),
            ("PedVarietyMultiplier", "0.850000"),
            ("VehicleVarietyMultiplier", "0.850000"),
            ("Lighting_FogVolumes", "true"),
            ("Shader_SSA", "true"),
        ],
    },
];

// ============================================================================
// Tier 4: HIGH (VRAM >= 10GB / RAM >= 16GB / >= 8 threads)
// ============================================================================
const HIGH_PRESETS: &[AdaptivePresetSpec] = &[
    AdaptivePresetSpec {
        id: "ultra-fps",
        name: "Ultra FPS · เฟรมสูงระดับแข่ง (ภาพยังคม)",
        subtitle: "สำหรับเครื่องสเปกสูงที่ต้องการเฟรมสูงสุด — คง Texture High + FXAA + AF 8x ไว้ให้ภาพคมชัดโดยไม่สูญเสียเฟรม",
        badge: "FPS สูงสุด",
        recommended: false,
        vram_target: "~2.8–3.8 GB",
        fps_score: 5,
        visual_score: 3,
        highlights: &[
            "Texture: High · Shadow: Normal · Shader/Refl/Grass: Normal",
            "เปิด FXAA + Anisotropic 8x · Distance 60% ภาพไม่แตก",
            "ปิด PostFX, SSAO, MSAA, Motion Blur รีดเฟรมสูงสุด",
        ],
        values: &[
            ("TextureQuality", "1"),
            ("ShaderQuality", "0"),
            ("ShadowQuality", "1"),
            ("ReflectionQuality", "0"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "0"),
            ("WaterQuality", "0"),
            ("ParticleQuality", "0"),
            ("GrassQuality", "0"),
            ("PostFX", "0"),
            ("Shadow_SoftShadows", "0"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "0.750000"),
            ("Tessellation", "0"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "8"),
            ("LodScale", "0.700000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.600000"),
            ("CityDensity", "0.500000"),
            ("PedVarietyMultiplier", "0.500000"),
            ("VehicleVarietyMultiplier", "0.500000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "false"),
        ],
    },
    AdaptivePresetSpec {
        id: "balanced-rp",
        name: "Balanced RP · Very High ลื่นนิ่ง (แนะนำ)",
        subtitle: "ใช้พลังการ์ดจอระดับสูงเต็มที่ — Texture/Shader/Reflection ระดับ Very High แต่ตัด MSAA & Grass หนักออกเพื่อเฟรมลื่นทุกจุด",
        badge: "แนะนำสำหรับเครื่องนี้",
        recommended: true,
        vram_target: "~4.5–5.8 GB",
        fps_score: 4,
        visual_score: 4,
        highlights: &[
            "Texture / Shader / Reflection: Very High · Shadow: High",
            "FXAA + Anisotropic 16x + SSAO Normal · Distance 85%",
            "ปิด MSAA & Grass High รักษาเฟรมสูงนิ่งในเมืองคนแน่น",
        ],
        values: &[
            ("TextureQuality", "2"),
            ("ShaderQuality", "2"),
            ("ShadowQuality", "2"),
            ("ReflectionQuality", "2"),
            ("ReflectionMSAA", "0"),
            ("SSAO", "1"),
            ("WaterQuality", "1"),
            ("ParticleQuality", "1"),
            ("GrassQuality", "0"),
            ("PostFX", "1"),
            ("Shadow_SoftShadows", "2"),
            ("Shadow_LongShadows", "false"),
            ("Shadow_ParticleShadows", "false"),
            ("Shadow_Distance", "1.000000"),
            ("Tessellation", "1"),
            ("MSAA", "0"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "16"),
            ("LodScale", "0.900000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "0.850000"),
            ("CityDensity", "0.750000"),
            ("PedVarietyMultiplier", "0.750000"),
            ("VehicleVarietyMultiplier", "0.750000"),
            ("Lighting_FogVolumes", "false"),
            ("Shader_SSA", "true"),
        ],
    },
    AdaptivePresetSpec {
        id: "high-visual",
        name: "Cinematic Ultra · ภาพสวยจัดเต็ม / สตรีม",
        subtitle: "จัดเต็มแสงเงา Very High, MSAA 2x, SSAO High, Long/Particle Shadows และ Fog Volumes สำหรับถ่ายภาพหรือสตรีมคุณภาพสูงสุด",
        badge: "ภาพสวยสุดเต็มสเปก",
        recommended: false,
        vram_target: "~6.5–9.0 GB",
        fps_score: 3,
        visual_score: 5,
        highlights: &[
            "Texture / Shader / Shadow / Reflection / PostFX: Very High",
            "MSAA 2x + FXAA + Anisotropic 16x + SSAO High",
            "เปิด Long & Particle Shadows + Fog Volumes (ปิด Motion Blur)",
        ],
        values: &[
            ("TextureQuality", "2"),
            ("ShaderQuality", "2"),
            ("ShadowQuality", "3"),
            ("ReflectionQuality", "2"),
            ("ReflectionMSAA", "2"),
            ("SSAO", "2"),
            ("WaterQuality", "2"),
            ("ParticleQuality", "2"),
            ("GrassQuality", "1"),
            ("PostFX", "2"),
            ("Shadow_SoftShadows", "3"),
            ("Shadow_LongShadows", "true"),
            ("Shadow_ParticleShadows", "true"),
            ("Shadow_Distance", "1.000000"),
            ("Tessellation", "2"),
            ("MSAA", "2"),
            ("FXAA_Enabled", "true"),
            ("TXAA_Enabled", "false"),
            ("DoF", "false"),
            ("MotionBlurStrength", "0.000000"),
            ("AnisotropicFiltering", "16"),
            ("LodScale", "1.000000"),
            ("PedLodBias", "0.000000"),
            ("VehicleLodBias", "0.000000"),
            ("DistanceScaling", "1.000000"),
            ("CityDensity", "1.000000"),
            ("PedVarietyMultiplier", "1.000000"),
            ("VehicleVarietyMultiplier", "1.000000"),
            ("Lighting_FogVolumes", "true"),
            ("Shader_SSA", "true"),
        ],
    },
];

fn ensure_game_closed() -> Result<(), String> {
    let names = get_process_names()
        .map_err(|_| "ตรวจสอบสถานะเกมไม่สำเร็จ กรุณาปิด FiveM / GTA V ก่อนปรับพรีเซ็ต".to_string())?;
    if names.iter().any(|n| {
        let lower = n.to_ascii_lowercase();
        is_fivem_process(&lower) || lower == "gta5.exe" || lower == "gta5_enhanced.exe"
    }) {
        return Err("กรุณาปิด FiveM / GTA V ทุกหน้าต่างก่อนปรับพรีเซ็ตกราฟิก (เพื่อไม่ให้เกมเขียนทับค่าเดิม)".into());
    }
    Ok(())
}

#[cfg(windows)]
fn resolve_windows_documents_dir() -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") {
        if let Ok(val) = key.get_value::<String, _>("Personal") {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                let expanded = if let Ok(up) = std::env::var("USERPROFILE") {
                    trimmed.replace("%USERPROFILE%", &up)
                } else {
                    trimmed.to_string()
                };
                return Some(PathBuf::from(expanded));
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn resolve_windows_documents_dir() -> Option<PathBuf> {
    None
}

pub fn locate_gtav_settings_xml() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(docs) = resolve_windows_documents_dir() {
        candidates.push(docs.join("Rockstar Games").join("GTA V").join("settings.xml"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let base = PathBuf::from(&profile);
        candidates.push(base.join("Documents").join("Rockstar Games").join("GTA V").join("settings.xml"));
        candidates.push(
            base.join("OneDrive")
                .join("Documents")
                .join("Rockstar Games")
                .join("GTA V")
                .join("settings.xml"),
        );
    }
    for cand in candidates {
        let norm = normalize_win_path(&cand);
        if norm.is_file() && assert_no_links(&norm).is_ok() {
            return Some(norm);
        }
    }
    None
}

fn read_xml_tag_value(xml_section: &str, tag: &str) -> Option<String> {
    let pattern = format!(r#"<{}\s+value="([^"]*)"\s*/?>"#, regex::escape(tag));
    let re = Regex::new(&pattern).ok()?;
    re.captures(xml_section).map(|c| c[1].trim().to_string())
}

fn extract_section<'a>(xml: &'a str, tag: &str) -> Option<(usize, usize, &'a str)> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)?;
    let inner_start = start + open.len();
    let end_rel = xml[inner_start..].find(&close)?;
    let inner_end = inner_start + end_rel;
    Some((inner_start, inner_end, &xml[inner_start..inner_end]))
}

fn quality_label(val: Option<&str>, allow_ultra: bool) -> String {
    match val.unwrap_or("") {
        "0" => "Normal".into(),
        "1" => "High".into(),
        "2" => "Very High".into(),
        "3" if allow_ultra => "Ultra".into(),
        "" => "—".into(),
        other => other.into(),
    }
}

fn shadow_quality_label(val: Option<&str>) -> String {
    match val.unwrap_or("") {
        "0" => "Off".into(),
        "1" => "Normal".into(),
        "2" => "High".into(),
        "3" => "Very High".into(),
        "" => "—".into(),
        other => other.into(),
    }
}

fn parse_summary_from_xml(xml: &str) -> CurrentGraphicsSummary {
    let gfx = extract_section(xml, "graphics").map(|(_, _, s)| s).unwrap_or(xml);
    let vid = extract_section(xml, "video").map(|(_, _, s)| s).unwrap_or("");

    let sw = read_xml_tag_value(vid, "ScreenWidth");
    let sh = read_xml_tag_value(vid, "ScreenHeight");
    let hz = read_xml_tag_value(vid, "RefreshRate");
    let resolution = match (sw, sh) {
        (Some(w), Some(h)) => match hz {
            Some(r) if !r.is_empty() => format!("{w}×{h} @ {r}Hz"),
            _ => format!("{w}×{h}"),
        },
        _ => "—".into(),
    };
    let window_mode = match read_xml_tag_value(vid, "Windowed").as_deref() {
        Some("0") => "Fullscreen".into(),
        Some("1") => "Windowed".into(),
        Some("2") => "Borderless".into(),
        _ => "—".into(),
    };

    let msaa_val = read_xml_tag_value(gfx, "MSAA");
    let msaa = match msaa_val.as_deref() {
        Some("0") => "Off".into(),
        Some(v) if !v.is_empty() => format!("{v}x"),
        _ => "—".into(),
    };
    let fxaa = read_xml_tag_value(gfx, "FXAA_Enabled")
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    CurrentGraphicsSummary {
        resolution,
        window_mode,
        texture: quality_label(read_xml_tag_value(gfx, "TextureQuality").as_deref(), false),
        shader: quality_label(read_xml_tag_value(gfx, "ShaderQuality").as_deref(), false),
        shadow: shadow_quality_label(read_xml_tag_value(gfx, "ShadowQuality").as_deref()),
        grass: quality_label(read_xml_tag_value(gfx, "GrassQuality").as_deref(), true),
        post_fx: quality_label(read_xml_tag_value(gfx, "PostFX").as_deref(), true),
        reflection: quality_label(read_xml_tag_value(gfx, "ReflectionQuality").as_deref(), true),
        msaa,
        fxaa,
    }
}

fn detect_matching_preset_id(xml: &str, specs: &[AdaptivePresetSpec]) -> String {
    let Some((_, _, gfx)) = extract_section(xml, "graphics") else {
        return "custom".into();
    };
    let check_keys = [
        "TextureQuality",
        "ShaderQuality",
        "ShadowQuality",
        "GrassQuality",
        "PostFX",
        "ReflectionQuality",
        "MSAA",
        "FXAA_Enabled",
        "AnisotropicFiltering",
        "CityDensity",
        "DistanceScaling",
    ];
    for spec in specs {
        let mut all_match = true;
        for key in check_keys {
            let expected = spec.values.iter().find(|(k, _)| *k == key).map(|(_, v)| *v);
            let actual = read_xml_tag_value(gfx, key);
            if let Some(exp) = expected {
                match actual {
                    Some(act) => {
                        let same = if let (Ok(a), Ok(b)) = (act.parse::<f64>(), exp.parse::<f64>()) {
                            (a - b).abs() < 0.02
                        } else {
                            act.eq_ignore_ascii_case(exp)
                        };
                        if !same {
                            all_match = false;
                            break;
                        }
                    }
                    None => {
                        all_match = false;
                        break;
                    }
                }
            }
        }
        if all_match {
            return spec.id.to_string();
        }
    }
    "custom".into()
}

/// Surgically updates ONLY tags inside `<graphics>...</graphics>`, keeping `<video>` and all other
/// sections 100% untouched (monitor, resolution, refresh rate, windowed mode).
pub fn apply_graphics_values_to_xml(xml: &str, values: &[(&str, &str)]) -> Result<String, String> {
    let Some((inner_start, inner_end, gfx_slice)) = extract_section(xml, "graphics") else {
        return Err("ไม่พบหมวด <graphics> ในไฟล์ settings.xml ของ GTA V".into());
    };
    let mut gfx_owned = gfx_slice.to_string();
    let newline = if xml.contains("\r\n") { "\r\n" } else { "\n" };

    for &(tag, val) in values {
        let pattern = format!(r#"<{}\s+value="[^"]*"(\s*/>)"#, regex::escape(tag));
        let re = Regex::new(&pattern).map_err(|e| format!("Regex error: {e}"))?;
        if re.is_match(&gfx_owned) {
            gfx_owned = re
                .replace(&gfx_owned, format!(r#"<{tag} value="{val}"$1"#))
                .into_owned();
        } else {
            // Insert cleanly before closing </graphics>
            static INDENT_RE: OnceLock<Regex> = OnceLock::new();
            let indent = INDENT_RE
                .get_or_init(|| Regex::new(r"(?m)^([ \t]+)<[A-Za-z]").unwrap())
                .captures(&gfx_owned)
                .map(|c| c[1].to_string())
                .unwrap_or_else(|| "    ".to_string());
            if !gfx_owned.ends_with('\n') {
                gfx_owned.push_str(newline);
            }
            gfx_owned.push_str(&format!(r#"{indent}<{tag} value="{val}" />{newline}"#));
        }
    }

    let mut out = String::with_capacity(xml.len() + 256);
    out.push_str(&xml[..inner_start]);
    out.push_str(&gfx_owned);
    out.push_str(&xml[inner_end..]);
    Ok(out)
}

fn map_specs_to_info(specs: &[AdaptivePresetSpec], active_id: &str) -> Vec<GamePerfPresetInfo> {
    specs
        .iter()
        .map(|s| GamePerfPresetInfo {
            id: s.id.into(),
            name: s.name.into(),
            subtitle: s.subtitle.into(),
            badge: s.badge.into(),
            recommended: s.recommended,
            vram_target: s.vram_target.into(),
            fps_score: s.fps_score,
            visual_score: s.visual_score,
            highlights: s.highlights.iter().map(|h| (*h).into()).collect(),
            active: active_id == s.id,
        })
        .collect()
}

fn build_state_for_path_with_hw(
    settings_path: Option<&Path>,
    hardware: HardwareProfile,
) -> Result<GamePerfPresetsState, String> {
    let specs = build_presets_for_tier(&hardware.tier);
    let Some(path) = settings_path else {
        return Ok(GamePerfPresetsState {
            found: false,
            settings_path: String::new(),
            has_backup: false,
            active_preset_id: "none".into(),
            presets: map_specs_to_info(specs, ""),
            hardware,
            current: CurrentGraphicsSummary::default(),
        });
    };

    assert_no_links(path)?;
    let xml = fs::read_to_string(path)
        .map_err(|e| format!("อ่านไฟล์ settings.xml ของ GTA V ไม่สำเร็จ: {e}"))?;
    let backup_path = path
        .parent()
        .map(|p| normalize_win_path(&p.join(BACKUP_FILE_NAME)));
    let has_backup = backup_path
        .as_ref()
        .map(|b| b.is_file() && assert_no_links(b).is_ok())
        .unwrap_or(false);
    let active_id = detect_matching_preset_id(&xml, specs);
    let current = parse_summary_from_xml(&xml);

    Ok(GamePerfPresetsState {
        found: true,
        settings_path: path.to_string_lossy().into_owned(),
        has_backup,
        active_preset_id: active_id.clone(),
        presets: map_specs_to_info(specs, &active_id),
        hardware,
        current,
    })
}

fn apply_preset_to_path_with_hw(
    settings_path: &Path,
    preset_id: &str,
    hardware: HardwareProfile,
) -> Result<GamePerfPresetsState, String> {
    assert_no_links(settings_path)?;
    let specs = build_presets_for_tier(&hardware.tier);
    let spec = specs
        .iter()
        .find(|s| s.id == preset_id.trim())
        .ok_or_else(|| "ไม่พบพรีเซ็ตกราฟิกที่เลือก".to_string())?;

    let parent = settings_path
        .parent()
        .ok_or_else(|| "ไม่พบโฟลเดอร์ settings.xml ของ GTA V".to_string())?;
    assert_no_links(parent)?;

    let raw_xml = fs::read_to_string(settings_path)
        .map_err(|e| format!("อ่านไฟล์ settings.xml ไม่สำเร็จ: {e}"))?;

    // Auto-backup original untouched settings.xml once before first modification!
    let backup_path = normalize_win_path(&parent.join(BACKUP_FILE_NAME));
    if !backup_path.exists() {
        assert_no_links(&backup_path)?;
        fs::write(&backup_path, &raw_xml)
            .map_err(|e| format!("สำรองไฟล์ settings.xml เดิมไม่สำเร็จ: {e}"))?;
    }

    let updated = apply_graphics_values_to_xml(&raw_xml, spec.values)?;
    let tmp_path = normalize_win_path(&parent.join("settings.xml.estra.tmp"));
    assert_no_links(&tmp_path)?;
    fs::write(&tmp_path, &updated)
        .map_err(|e| format!("เขียนไฟล์ settings.xml ชั่วคราวไม่สำเร็จ: {e}"))?;
    fs::rename(&tmp_path, settings_path)
        .map_err(|e| format!("บันทึกไฟล์ settings.xml ไม่สำเร็จ: {e}"))?;

    build_state_for_path_with_hw(Some(settings_path), hardware)
}

pub fn restore_backup_at_path_with_hw(
    settings_path: &Path,
    hardware: HardwareProfile,
) -> Result<GamePerfPresetsState, String> {
    assert_no_links(settings_path)?;
    let parent = settings_path
        .parent()
        .ok_or_else(|| "ไม่พบโฟลเดอร์ settings.xml ของ GTA V".to_string())?;
    let backup_path = normalize_win_path(&parent.join(BACKUP_FILE_NAME));
    if !backup_path.is_file() {
        return Err("ไม่พบไฟล์สำรอง settings.xml เดิม".into());
    }
    assert_no_links(&backup_path)?;
    let original = fs::read_to_string(&backup_path)
        .map_err(|e| format!("อ่านไฟล์สำรองไม่สำเร็จ: {e}"))?;
    let tmp_path = normalize_win_path(&parent.join("settings.xml.estra.tmp"));
    assert_no_links(&tmp_path)?;
    fs::write(&tmp_path, &original)
        .map_err(|e| format!("เตรียมไฟล์คืนค่าไม่สำเร็จ: {e}"))?;
    fs::rename(&tmp_path, settings_path)
        .map_err(|e| format!("คืนค่า settings.xml เดิมไม่สำเร็จ: {e}"))?;
    build_state_for_path_with_hw(Some(settings_path), hardware)
}

pub fn get_game_perf_presets_state() -> Result<GamePerfPresetsState, String> {
    let found = locate_gtav_settings_xml();
    build_state_for_path_with_hw(found.as_deref(), detect_hardware_profile())
}

pub fn apply_game_perf_preset(preset_id: &str) -> Result<GamePerfPresetsState, String> {
    ensure_game_closed()?;
    let path = locate_gtav_settings_xml().ok_or_else(|| {
        "ไม่พบไฟล์ Documents\\Rockstar Games\\GTA V\\settings.xml — กรุณาเปิดเกม GTA V / FiveM อย่างน้อย 1 ครั้งก่อน".to_string()
    })?;
    apply_preset_to_path_with_hw(&path, preset_id, detect_hardware_profile())
}

pub fn restore_game_perf_backup() -> Result<GamePerfPresetsState, String> {
    ensure_game_closed()?;
    let path = locate_gtav_settings_xml().ok_or_else(|| {
        "ไม่พบไฟล์ Documents\\Rockstar Games\\GTA V\\settings.xml".to_string()
    })?;
    restore_backup_at_path_with_hw(&path, detect_hardware_profile())
}

pub fn open_gtav_settings_folder() -> Result<String, String> {
    let path = locate_gtav_settings_xml().ok_or_else(|| {
        "ไม่พบไฟล์ settings.xml ของ GTA V".to_string()
    })?;
    let folder = path.parent().unwrap_or(&path);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("explorer.exe")
            .arg(folder)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("เปิดโฟลเดอร์ไม่สำเร็จ: {e}"))?;
    }
    Ok(folder.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const SAMPLE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Settings>
  <version value="27" />
  <graphics>
    <Tessellation value="2" />
    <LodScale value="1.000000" />
    <PedLodBias value="0.200000" />
    <VehicleLodBias value="0.000000" />
    <ShadowQuality value="3" />
    <ReflectionQuality value="3" />
    <ReflectionMSAA value="4" />
    <SSAO value="2" />
    <AnisotropicFiltering value="16" />
    <MSAA value="4" />
    <FXAA_Enabled value="true" />
    <TXAA_Enabled value="false" />
    <Lighting_FogVolumes value="true" />
    <Shader_SSA value="true" />
    <TextureQuality value="2" />
    <ParticleQuality value="2" />
    <WaterQuality value="2" />
    <GrassQuality value="3" />
    <ShaderQuality value="2" />
    <Shadow_SoftShadows value="4" />
    <Shadow_LongShadows value="true" />
    <Shadow_ParticleShadows value="true" />
    <Shadow_Distance value="1.000000" />
    <PostFX value="3" />
    <DoF value="true" />
    <MotionBlurStrength value="0.500000" />
    <DistanceScaling value="1.000000" />
    <CityDensity value="1.000000" />
    <PedVarietyMultiplier value="1.000000" />
    <VehicleVarietyMultiplier value="1.000000" />
  </graphics>
  <video>
    <ScreenWidth value="2560" />
    <ScreenHeight value="1440" />
    <RefreshRate value="165" />
    <Windowed value="2" />
  </video>
</Settings>
"#;

    fn mock_hw(tier: &str, vram_mb: u64, ram_gb: u32, cpu_cores: u32, is_integrated: bool) -> HardwareProfile {
        let (t, lbl, sum, rec) = classify_hardware_tier(vram_mb, ram_gb, cpu_cores, is_integrated);
        assert_eq!(t, tier);
        HardwareProfile {
            gpu_name: format!("Mock GPU ({tier})"),
            vram_mb,
            shared_mem_mb: 4096,
            ram_gb,
            cpu_cores,
            is_integrated,
            tier: t.into(),
            tier_label: lbl.into(),
            tier_summary: sum.into(),
            recommended_preset_id: rec.into(),
        }
    }

    #[test]
    fn classifies_all_four_hardware_tiers_accurately() {
        // Integrated UHD / 8GB RAM -> potato
        let (t1, _, _, rec1) = classify_hardware_tier(512, 8, 8, true);
        assert_eq!(t1, "potato");
        assert_eq!(rec1, "ultra-fps");

        // GTX 1050 2GB / 16GB RAM -> potato (VRAM < 3200)
        let (t2, _, _, _) = classify_hardware_tier(2048, 16, 8, false);
        assert_eq!(t2, "potato");

        // GTX 1650 4GB / 16GB RAM / 8 threads -> entry
        let (t3, _, _, rec3) = classify_hardware_tier(4096, 16, 8, false);
        assert_eq!(t3, "entry");
        assert_eq!(rec3, "balanced-rp");

        // RTX 3060 Ti 8GB / 16GB RAM / 12 threads -> mid
        let (t4, _, _, rec4) = classify_hardware_tier(8192, 16, 12, false);
        assert_eq!(t4, "mid");
        assert_eq!(rec4, "balanced-rp");

        // RTX 4070 12GB / 32GB RAM / 16 threads -> high
        let (t5, _, _, rec5) = classify_hardware_tier(12288, 32, 16, false);
        assert_eq!(t5, "high");
        assert_eq!(rec5, "balanced-rp");

        // Every tier must always expose exactly 3 adaptive presets
        for tier in ["potato", "entry", "mid", "high"] {
            let specs = build_presets_for_tier(tier);
            assert_eq!(specs.len(), 3, "tier {tier} must have 3 presets");
            assert_eq!(specs[0].id, "ultra-fps");
            assert_eq!(specs[1].id, "balanced-rp");
            assert_eq!(specs[2].id, "high-visual");
        }
    }

    #[test]
    fn potato_vs_high_tier_presets_adapt_xml_aggressively() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("estra_perf_adaptive_test_{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        let settings_path = dir.join("settings.xml");
        fs::write(&settings_path, SAMPLE_XML).unwrap();

        // 1) Potato Ultra FPS: zeroes out LodScale, CityDensity, DistanceScaling, ShadowQuality=0
        let potato_hw = mock_hw("potato", 1024, 8, 4, true);
        let applied_potato = apply_preset_to_path_with_hw(&settings_path, "ultra-fps", potato_hw.clone()).unwrap();
        assert!(applied_potato.found);
        assert!(applied_potato.has_backup);
        assert_eq!(applied_potato.presets.len(), 3);
        assert_eq!(applied_potato.active_preset_id, "ultra-fps");
        assert_eq!(applied_potato.current.shadow, "Off");
        assert_eq!(applied_potato.current.texture, "Normal");
        assert!(!applied_potato.current.fxaa);
        assert_eq!(applied_potato.current.resolution, "2560×1440 @ 165Hz");
        assert_eq!(applied_potato.current.window_mode, "Borderless");

        let potato_raw = fs::read_to_string(&settings_path).unwrap();
        assert!(potato_raw.contains(r#"<LodScale value="0.000000" />"#));
        assert!(potato_raw.contains(r#"<CityDensity value="0.000000" />"#));
        assert!(potato_raw.contains(r#"<DistanceScaling value="0.000000" />"#));
        assert!(potato_raw.contains(r#"<ScreenWidth value="2560" />"#));
        assert!(potato_raw.contains(r#"<RefreshRate value="165" />"#));

        // 2) Potato High Visual still caps safely (no MSAA, Texture High, Grass Normal)
        let potato_vis = apply_preset_to_path_with_hw(&settings_path, "high-visual", potato_hw.clone()).unwrap();
        assert_eq!(potato_vis.active_preset_id, "high-visual");
        assert_eq!(potato_vis.current.texture, "High");
        assert_eq!(potato_vis.current.msaa, "Off");
        assert_eq!(potato_vis.current.grass, "Normal");

        // 3) High-End High Visual unlocks Very High + MSAA 2x + Long Shadows
        let high_hw = mock_hw("high", 12288, 32, 16, false);
        let high_vis = apply_preset_to_path_with_hw(&settings_path, "high-visual", high_hw.clone()).unwrap();
        assert_eq!(high_vis.active_preset_id, "high-visual");
        assert_eq!(high_vis.current.texture, "Very High");
        assert_eq!(high_vis.current.shadow, "Very High");
        assert_eq!(high_vis.current.msaa, "2x");
        assert!(high_vis.current.fxaa);

        // 4) Restore original backup -> byte-for-byte identical to SAMPLE_XML
        let restored = restore_backup_at_path_with_hw(&settings_path, high_hw).unwrap();
        assert_eq!(restored.active_preset_id, "custom");
        assert_eq!(fs::read_to_string(&settings_path).unwrap(), SAMPLE_XML);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_real_host_hardware_profile() {
        let hw = detect_hardware_profile();
        assert!(!hw.gpu_name.is_empty());
        assert!(hw.ram_gb >= 1);
        assert!(hw.cpu_cores >= 1);
        assert!(matches!(hw.tier.as_str(), "potato" | "entry" | "mid" | "high"));
        assert_eq!(build_presets_for_tier(&hw.tier).len(), 3);
        println!(
            "Detected Host Hardware: GPU={} ({} MB VRAM, shared {} MB, iGPU={}) | RAM={} GB | CPU={} threads | Tier={}",
            hw.gpu_name, hw.vram_mb, hw.shared_mem_mb, hw.is_integrated, hw.ram_gb, hw.cpu_cores, hw.tier
        );
    }
}
