//! HaloFire Studio desktop shell — Tauri 2 host.
//!
//! Process tree:
//!   * This Rust host owns the OS window + WebView2/WKWebView.
//!   * Frontend = `apps/editor` static export, served via
//!     tauri://localhost/.
//!   * Python sidecar (halofire-pipeline.exe) owns the CAD pipeline,
//!     spawned per-job via tauri-plugin-shell. stdin JSON in,
//!     stdout NDJSON out.
//!   * OpenSCAD (openscad.exe) invoked per-render for parametric
//!     parts geometry. Results cached under app_data_dir()/openscad.
//!
//! No HTTP, no localhost ports. Everything IPC.
mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            env_logger::try_init().ok();
            log::info!("HaloFire Studio starting");
            // Ensure our per-user data dirs exist up-front so the
            // first render_scad call doesn't race on mkdir.
            if let Ok(app_data) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(app_data.join("openscad-cache"));
                let _ = std::fs::create_dir_all(app_data.join("projects"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::host::greet,
            commands::host::versions,
            commands::pipeline::run_pipeline,
            commands::hydraulic::run_hydraulic,
            commands::hydraulic::read_deliverable,
            commands::scad::render_scad,
            commands::scad::scad_runtime_status,
            commands::catalog::list_scad_templates,
            commands::project::list_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Re-export so the binary crate can call `run()`.
pub use tauri::Manager;
