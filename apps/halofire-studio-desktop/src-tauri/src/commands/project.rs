//! list_projects — enumerate .hfproj directories under
//! `app_data_dir()/projects/`. Foundation for Phase E project
//! save/load.

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct ProjectEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub modified_epoch_ms: u128,
}

#[tauri::command]
pub async fn list_projects(app: AppHandle) -> Result<Vec<ProjectEntry>, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    if !base.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&base).map_err(|e| e.to_string())? {
        let e = entry.map_err(|err| err.to_string())?;
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let md = e.metadata().map_err(|err| err.to_string())?;
        let mtime = md
            .modified()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "time")))
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let id = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        // Read manifest.json if present for a friendlier name.
        let manifest_path = path.join("manifest.json");
        let name = if manifest_path.is_file() {
            std::fs::read_to_string(&manifest_path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("name").and_then(|n| n.as_str().map(String::from)))
                .unwrap_or_else(|| id.clone())
        } else {
            id.clone()
        };
        out.push(ProjectEntry {
            id,
            name,
            path: path.to_string_lossy().into(),
            modified_epoch_ms: mtime,
        });
    }
    out.sort_by(|a, b| b.modified_epoch_ms.cmp(&a.modified_epoch_ms));
    Ok(out)
}
