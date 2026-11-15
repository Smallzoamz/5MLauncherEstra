use serde_json::Value;
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const SUPABASE_ORIGIN: &str = "https://hcynletyqztbbouwlcsg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_puj9yz5BQ_i3DEmhnpgmww_4fifPu5e";
const GITHUB_REPO: &str = "Smallzoamz/5MLauncherEstra";
const DISCORD_APPLICATION_ID: &str = "1545873345596096734";

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn xor_with_mask(raw: &[u8], mask: &[u8; 32]) -> Vec<u8> {
    raw.iter()
        .enumerate()
        .map(|(i, b)| b ^ mask[i % mask.len()] ^ ((i as u8).wrapping_mul(31)))
        .collect()
}

fn format_byte_slice(name: &str, bytes: &[u8]) -> String {
    let items: Vec<String> = bytes.iter().map(|b| format!("0x{b:02x}")).collect();
    format!("pub const {name}: &[u8] = &[{}];\n", items.join(", "))
}

fn collect_dist_assets(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|v| v.path())).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            println!("cargo:rerun-if-changed={}", path.display());
            collect_dist_assets(base, &path, out);
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if !matches!(ext, "js" | "css") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", path.display());
        if let (Ok(rel), Ok(bytes)) = (path.strip_prefix(base), fs::read(&path)) {
            let rel_norm = rel.to_string_lossy().replace('\\', "/");
            out.push((rel_norm, sha256_hex(&bytes)));
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=../src/shared/patcherConfig.js");
    println!("cargo:rerun-if-changed=../src/shared/supabaseConfig.js");
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../dist/assets");

    let conf_raw = fs::read_to_string("tauri.conf.json").expect("Failed to read tauri.conf.json");
    let conf: Value = serde_json::from_str(&conf_raw).expect("Invalid tauri.conf.json");

    let product_name = conf
        .get("productName")
        .and_then(|v| v.as_str())
        .unwrap_or("Estra FiveM Launcher");
    let identifier = conf
        .get("identifier")
        .and_then(|v| v.as_str())
        .unwrap_or("local.fivemlauncher.desktop");
    let updater_pubkey = conf
        .pointer("/plugins/updater/pubkey")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let updater_endpoint = conf
        .pointer("/plugins/updater/endpoints/0")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let brand_tuple = format!(
        "{product_name}|{identifier}|{updater_pubkey}|{updater_endpoint}|{GITHUB_REPO}|{SUPABASE_ORIGIN}|{DISCORD_APPLICATION_ID}"
    );
    let expected_brand_digest = sha256_hex(brand_tuple.as_bytes());

    let mut mask_hasher = Sha256::new();
    mask_hasher.update(expected_brand_digest.as_bytes());
    mask_hasher.update(b"::estra-re-shield-v1");
    let mask_digest = mask_hasher.finalize();
    let mut mask = [0u8; 32];
    mask.copy_from_slice(&mask_digest[..32]);

    let dist_dir = Path::new("../dist");
    let mut dist_assets = Vec::new();
    let mut index_required_refs = Vec::new();
    let index_html_path = dist_dir.join("index.html");
    if index_html_path.is_file() {
        println!("cargo:rerun-if-changed={}", index_html_path.display());
        collect_dist_assets(dist_dir, dist_dir, &mut dist_assets);
        if let Ok(index_html) = fs::read_to_string(&index_html_path) {
            for (rel, _) in &dist_assets {
                if index_html.contains(rel.as_str()) {
                    index_required_refs.push(rel.clone());
                }
            }
        }
    }

    let mut generated = String::new();
    generated.push_str(&format!(
        "pub const EXPECTED_BRAND_DIGEST: &str = \"{expected_brand_digest}\";\n"
    ));
    generated.push_str(&format!(
        "pub const SHIELD_MASK: [u8; 32] = [{}];\n",
        mask.iter()
            .map(|b| format!("0x{b:02x}"))
            .collect::<Vec<_>>()
            .join(", ")
    ));
    generated.push_str(&format_byte_slice(
        "OBF_SUPABASE_ORIGIN",
        &xor_with_mask(SUPABASE_ORIGIN.as_bytes(), &mask),
    ));
    generated.push_str(&format_byte_slice(
        "OBF_SUPABASE_KEY",
        &xor_with_mask(SUPABASE_PUBLISHABLE_KEY.as_bytes(), &mask),
    ));
    generated.push_str(&format_byte_slice(
        "OBF_GITHUB_REPO",
        &xor_with_mask(GITHUB_REPO.as_bytes(), &mask),
    ));
    generated.push_str(&format_byte_slice(
        "OBF_DISCORD_APP_ID",
        &xor_with_mask(DISCORD_APPLICATION_ID.as_bytes(), &mask),
    ));
    generated.push_str(&format_byte_slice(
        "OBF_PRODUCT_NAME",
        &xor_with_mask(product_name.as_bytes(), &mask),
    ));
    generated.push_str(&format_byte_slice(
        "OBF_IDENTIFIER",
        &xor_with_mask(identifier.as_bytes(), &mask),
    ));
    generated.push_str(&format_byte_slice(
        "OBF_UPDATER_PUBKEY",
        &xor_with_mask(updater_pubkey.as_bytes(), &mask),
    ));
    generated.push_str(&format_byte_slice(
        "OBF_UPDATER_ENDPOINT",
        &xor_with_mask(updater_endpoint.as_bytes(), &mask),
    ));

    generated.push_str("pub const DIST_ASSET_MANIFEST: &[(&str, &str)] = &[\n");
    for (rel, digest) in &dist_assets {
        generated.push_str(&format!("    ({rel:?}, {digest:?}),\n"));
    }
    generated.push_str("];\n");

    generated.push_str("pub const INDEX_REQUIRED_REFS: &[&str] = &[\n");
    for rel in &index_required_refs {
        generated.push_str(&format!("    {rel:?},\n"));
    }
    generated.push_str("];\n");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR missing"));
    fs::write(out_dir.join("integrity_consts.rs"), generated)
        .expect("Failed to write integrity_consts.rs");

    tauri_build::build();
}
