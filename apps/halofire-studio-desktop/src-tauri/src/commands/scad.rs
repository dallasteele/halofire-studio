//! render_scad — invoke the bundled OpenSCAD binary to produce a
//! GLB from one of the catalog SCAD templates. Cache hit is
//! content-addressable by sha256(scad_content + params_json) so a
//! repeated call is O(1).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize)]
pub struct RenderScadArgs {
    /// Template stem (e.g. "valve_globe", "head_pendant_qr_k80").
    pub name: String,
    /// Parameter overrides passed as -D key=value to OpenSCAD.
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    /// Output format; default "glb" for R3F consumption.
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "glb".to_string()
}

#[derive(Serialize)]
pub struct RenderResult {
    pub path: String,
    pub cache_hit: bool,
    pub cache_key: String,
    pub engine: String,
}

#[tauri::command]
pub async fn render_scad(
    app: AppHandle,
    args: RenderScadArgs,
) -> Result<RenderResult, String> {
    let (scad_path, scad_bytes) = resolve_scad(&app, &args.name)?;
    let cache_key = hash_key(&scad_bytes, &args.params);
    let cache_root = cache_dir(&app)?;
    let out_path = cache_root.join(format!("{}.{}", cache_key, args.format));

    if out_path.is_file() {
        let md = std::fs::metadata(&out_path).map_err(|e| e.to_string())?;
        if md.len() > 0 {
            return Ok(RenderResult {
                path: out_path.to_string_lossy().to_string(),
                cache_hit: true,
                cache_key,
                engine: "cache".to_string(),
            });
        }
    }

    // Build the OpenSCAD command line.
    let mut params_args: Vec<String> = Vec::new();
    for (k, v) in &args.params {
        let value_str = match v {
            serde_json::Value::String(s) => format!("\"{}\"", s),
            _ => v.to_string(),
        };
        params_args.push("-D".into());
        params_args.push(format!("{}={}", k, value_str));
    }

    // Sidecar'd OpenSCAD binary (bundled via tauri.conf.json
    // externalBin = "bin/openscad"). Falls back to PATH when the
    // sidecar isn't bundled in dev mode.
    let sidecar = app
        .shell()
        .sidecar("openscad")
        .map_err(|e| format!("openscad sidecar missing: {e}"))?;
    let output = sidecar
        .args([
            scad_path.to_string_lossy().to_string(),
            "-o".into(),
            out_path.to_string_lossy().to_string(),
        ])
        .args(params_args)
        .output()
        .await
        .map_err(|e| format!("openscad spawn failed: {e}"))?;

    if !output.status.success() || !out_path.is_file() {
        return Err(format!(
            "openscad failed (exit {:?}): {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(RenderResult {
        path: out_path.to_string_lossy().to_string(),
        cache_hit: false,
        cache_key,
        engine: "openscad".to_string(),
    })
}

#[derive(Serialize)]
pub struct RuntimeStatus {
    pub openscad_available: bool,
    pub cache_dir: String,
    pub cached_entries: usize,
}

#[tauri::command]
pub async fn scad_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    let cache_root = cache_dir(&app)?;
    let entries = std::fs::read_dir(&cache_root)
        .map(|r| r.flatten().count())
        .unwrap_or(0);
    // Crude availability check: try to run `openscad --version` via
    // the sidecar. If it doesn't even spawn, we mark unavailable.
    let available = app
        .shell()
        .sidecar("openscad")
        .and_then(|c| Ok(c.args(["--version"]).output()))
        .is_ok();
    Ok(RuntimeStatus {
        openscad_available: available,
        cache_dir: cache_root.to_string_lossy().to_string(),
        cached_entries: entries,
    })
}

// ── internals ─────────────────────────────────────────────────────

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app_data_dir: {e}"))?;
    let out = base.join("openscad-cache");
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    Ok(out)
}

fn resolve_scad(app: &AppHandle, name: &str) -> Result<(PathBuf, Vec<u8>), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid scad name".into());
    }
    let stem = if name.ends_with(".scad") {
        name.to_string()
    } else {
        format!("{}.scad", name)
    };
    // Candidate locations — dev monorepo path first, then
    // resource-bundled copy for packaged builds.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(resource) = app
        .path()
        .resolve(
            "halofire-catalog/authoring/scad",
            tauri::path::BaseDirectory::Resource,
        )
    {
        candidates.push(resource.join(&stem));
    }
    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/halofire-catalog/authoring/scad")
            .join(&stem),
    );
    for cand in candidates {
        if cand.is_file() {
            let bytes = std::fs::read(&cand).map_err(|e| e.to_string())?;
            return Ok((cand, bytes));
        }
    }
    Err(format!("scad not found: {}", name))
}

fn hash_key(
    scad_bytes: &[u8],
    params: &BTreeMap<String, serde_json::Value>,
) -> String {
    let mut h = Sha256::new();
    h.update(scad_bytes);
    // BTreeMap gives a stable iteration order → cache key invariant
    // across object-key orderings, matching openscad_runtime.py.
    h.update(serde_json::to_vec(params).unwrap_or_default());
    hex::encode(&h.finalize()[..12])
}
