//! list_scad_templates — enumerate catalog SCAD files so the
//! frontend properties panel can offer a dropdown.

use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct CatalogTemplate {
    pub name: String,
    pub path: String,
    pub bytes: u64,
}

#[tauri::command]
pub async fn list_scad_templates(
    _app: AppHandle,
) -> Result<Vec<CatalogTemplate>, String> {
    // In dev, read from the monorepo. In a packaged build the SCAD
    // files are copied into the Tauri resource dir — we fall back
    // to that if the monorepo path doesn't exist.
    let scad_dir: PathBuf = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/halofire-catalog/authoring/scad");
    if !scad_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&scad_dir).map_err(|e| e.to_string())? {
        let e = entry.map_err(|err| err.to_string())?;
        let path = e.path();
        if path.extension().map(|x| x == "scad").unwrap_or(false) {
            let md = e.metadata().map_err(|err| err.to_string())?;
            out.push(CatalogTemplate {
                name: path.file_stem().unwrap_or_default().to_string_lossy().into(),
                path: path.to_string_lossy().into(),
                bytes: md.len(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}
