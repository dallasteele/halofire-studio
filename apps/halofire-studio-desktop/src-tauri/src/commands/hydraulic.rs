//! R10.3 gap-close — Tauri commands that replace the LiveCalc
//! `fetch(GATEWAY_URL/…)` calls so the desktop shell is fully
//! self-contained (zero localhost ports).
//!
//! Two commands:
//!
//!   * `run_hydraulic` — reads `design.json` from the project
//!     deliverables directory and returns `{systems: [...]}`. This is
//!     "read" semantics, not "re-solve": the hydraulic solver already
//!     ran as part of the pipeline stage, and its output is persisted
//!     on `design.systems[i].hydraulic`. A real re-solve Tauri command
//!     (subprocess → `calc_system`) is post-ship; the LiveCalc panel
//!     only needs a fresh snapshot after scene edits.
//!
//!   * `read_deliverable` — reads an allow-listed JSON deliverable
//!     (`pipeline_summary.json`, `design.json`, etc.) from the
//!     project's deliverables dir. Path-traversal guards reject any
//!     name containing `..`, `/`, or `\`, and the extension must be
//!     `.json`.

use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHydraulicArgs {
    pub project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDeliverableArgs {
    pub project_id: String,
    pub name: String,
}

/// Validate that a project id is a single path component — no
/// separators, no `..`, no absolute paths. Returns the id if safe.
fn safe_project_id(project_id: &str) -> Result<&str, String> {
    if project_id.is_empty()
        || project_id.contains('/')
        || project_id.contains('\\')
        || project_id.contains("..")
        || project_id.contains(':')
    {
        return Err(format!("invalid project_id: {project_id:?}"));
    }
    Ok(project_id)
}

/// Validate a deliverable name. Only plain filenames with a `.json`
/// extension are permitted — no directory traversal, no alternate
/// extensions (yet).
fn safe_deliverable_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains(':')
        || name.starts_with('.')
    {
        return Err(format!("invalid deliverable name: {name:?}"));
    }
    // Allow-list extensions. JSON only for v1; extend as needed.
    if !name.to_ascii_lowercase().ends_with(".json") {
        return Err(format!(
            "deliverable extension not allowed: {name:?} (only .json)"
        ));
    }
    Ok(name)
}

/// R10.3 — read-semantics hydraulic "run".
///
/// Loads `app_data_dir()/projects/<id>/deliverables/design.json` and
/// returns the subset LiveCalc expects: `{systems: [{hydraulic, ...}]}`.
/// Any IO/parse error bubbles up as a string (LiveCalc already renders
/// errors as "gateway offline — <msg>"; harmless rename later).
#[tauri::command]
pub async fn run_hydraulic(
    app: AppHandle,
    args: RunHydraulicArgs,
) -> Result<serde_json::Value, String> {
    let project_id = safe_project_id(&args.project_id)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    let design_path = base
        .join("projects")
        .join(project_id)
        .join("deliverables")
        .join("design.json");
    if !design_path.is_file() {
        return Err(format!(
            "design.json not found for project {project_id:?} — run the pipeline first"
        ));
    }
    let raw = std::fs::read_to_string(&design_path)
        .map_err(|e| format!("read design.json: {e}"))?;
    let design: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("parse design.json: {e}"))?;
    // Pluck just `systems` so the response shape matches LiveCalc's
    // `body.systems[0].hydraulic` consumer. Fall back to the full
    // design if `systems` is absent (keeps legacy shapes working).
    let systems = design.get("systems").cloned().unwrap_or(design);
    Ok(serde_json::json!({ "systems": systems }))
}

/// R10.3 — read an allow-listed JSON deliverable from disk.
#[tauri::command]
pub async fn read_deliverable(
    app: AppHandle,
    args: ReadDeliverableArgs,
) -> Result<serde_json::Value, String> {
    let project_id = safe_project_id(&args.project_id)?;
    let name = safe_deliverable_name(&args.name)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    let deliverables = base
        .join("projects")
        .join(project_id)
        .join("deliverables");
    let path = deliverables.join(name);
    // Canonicalise and double-check containment. If `canonicalize`
    // fails (common on missing files), fall back to the lexical
    // check — the guards above already blocked traversal syntax.
    if let (Ok(real_base), Ok(real_path)) =
        (deliverables.canonicalize(), path.canonicalize())
    {
        if !real_path.starts_with(&real_base) {
            return Err(format!("deliverable escapes sandbox: {name:?}"));
        }
    }
    if !path.is_file() {
        return Err(format!("deliverable not found: {name:?}"));
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {name}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse {name}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_in_project_id() {
        assert!(safe_project_id("").is_err());
        assert!(safe_project_id("..").is_err());
        assert!(safe_project_id("a/b").is_err());
        assert!(safe_project_id("a\\b").is_err());
        assert!(safe_project_id("C:foo").is_err());
        assert!(safe_project_id("1881-cooperative").is_ok());
    }

    #[test]
    fn rejects_traversal_in_deliverable_name() {
        assert!(safe_deliverable_name("").is_err());
        assert!(safe_deliverable_name("../secret.json").is_err());
        assert!(safe_deliverable_name("sub/x.json").is_err());
        assert!(safe_deliverable_name("design.exe").is_err());
        assert!(safe_deliverable_name(".hidden.json").is_err());
        assert!(safe_deliverable_name("pipeline_summary.json").is_ok());
        assert!(safe_deliverable_name("design.json").is_ok());
    }
}
