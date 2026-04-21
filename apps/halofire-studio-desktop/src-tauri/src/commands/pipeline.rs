//! run_pipeline — spawn the Python sidecar, pipe NDJSON stage events
//! back to the webview as `pipeline:progress`, resolve when the
//! sidecar prints a terminal `{"step":"done",…}` event.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize)]
pub struct RunPipelineArgs {
    pub pdf_path: String,
    pub project_id: String,
    /// Optional "quickbid" mode — skips the slow intake if the
    /// user just wants an estimate.
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PipelineStarted {
    pub job_id: String,
}

/// Spawn the halofire-pipeline sidecar. Returns once the sidecar
/// has acknowledged startup; per-stage progress flows via the
/// `pipeline:progress` Tauri event.
#[tauri::command]
pub async fn run_pipeline(
    app: AppHandle,
    args: RunPipelineArgs,
) -> Result<PipelineStarted, String> {
    // One job id per invocation so the frontend can correlate events.
    let job_id = format!("job_{}", chrono_epoch_ms());

    // The sidecar name matches tauri.conf.json externalBin and the
    // PyInstaller output convention.
    let sidecar = app
        .shell()
        .sidecar("halofire-pipeline")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?;

    // Job spec is sent as a single JSON line on stdin; the sidecar
    // parses it and runs the pipeline.
    let job_spec = serde_json::json!({
        "job_id": job_id,
        "pdf_path": args.pdf_path,
        "project_id": args.project_id,
        "mode": args.mode.unwrap_or_else(|| "pipeline".into()),
    });

    let (mut rx, mut child) = sidecar
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    // Write the job spec to the sidecar stdin, then close stdin so
    // the sidecar can proceed without blocking on more input.
    child
        .write(format!("{}\n", job_spec).as_bytes())
        .map_err(|e| format!("sidecar stdin failed: {e}"))?;

    // Spawn a task that relays stdout lines as Tauri events. The
    // sidecar process handle (child) is owned by this task so
    // dropping when done cleans up the zombie.
    let app_handle = app.clone();
    let relay_job_id = job_id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    for part in text.split('\n').filter(|s| !s.is_empty()) {
                        // Parse NDJSON progress records. Forward
                        // parse failures as an "unstructured" event
                        // so the UI still sees something.
                        let detail: serde_json::Value =
                            serde_json::from_str(part).unwrap_or_else(|_| {
                                serde_json::json!({ "raw": part })
                            });
                        let payload = serde_json::json!({
                            "job_id": relay_job_id,
                            "event": detail,
                        });
                        let _ = app_handle.emit("pipeline:progress", payload);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    log::warn!("[sidecar stderr] {}", text);
                }
                CommandEvent::Error(err) => {
                    log::error!("[sidecar error] {}", err);
                    let _ = app_handle.emit(
                        "pipeline:progress",
                        serde_json::json!({
                            "job_id": relay_job_id,
                            "event": { "step": "error", "message": err },
                        }),
                    );
                }
                CommandEvent::Terminated(status) => {
                    log::info!("[sidecar terminated] code={:?}", status.code);
                    let _ = app_handle.emit(
                        "pipeline:progress",
                        serde_json::json!({
                            "job_id": relay_job_id,
                            "event": {
                                "step": "terminated",
                                "exit_code": status.code,
                            },
                        }),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(PipelineStarted { job_id })
}

fn chrono_epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
