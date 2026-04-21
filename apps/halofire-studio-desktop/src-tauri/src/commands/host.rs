//! Host info commands — wiring smoke-tests.

use serde::Serialize;

#[tauri::command]
pub fn greet(name: String) -> String {
    format!("HaloFire Studio says hi, {}", name)
}

#[derive(Serialize)]
pub struct Versions {
    pub app: String,
    pub tauri: String,
    pub rustc: String,
}

#[tauri::command]
pub fn versions() -> Versions {
    Versions {
        app: env!("CARGO_PKG_VERSION").to_string(),
        tauri: "2.x".to_string(),
        rustc: option_env!("RUSTC_VERSION").unwrap_or("unknown").to_string(),
    }
}
