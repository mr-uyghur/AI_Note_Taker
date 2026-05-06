mod auth;
mod recorder;
mod recorder_windows;
#[cfg(target_os = "macos")]
mod recorder_macos;
mod uploader;

use auth::AuthState;
use uploader::UploaderState;
#[cfg(target_os = "macos")]
use recorder_macos::MacosRecorderState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    run_app();
}

#[cfg(target_os = "macos")]
fn run_app() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AuthState(std::sync::Arc::new(
            std::sync::atomic::AtomicBool::new(false),
        )))
        .manage(UploaderState::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .manage(MacosRecorderState::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .invoke_handler(tauri::generate_handler![
            auth::verify_admin,
            auth::is_authenticated,
            auth::get_config,
            recorder::start_recording,
            recorder::stop_recording,
            recorder_windows::init_recording,
            recorder_windows::upload_chunk,
            recorder_windows::finalize_recording,
            recorder_macos::init_recording_macos,
            recorder_macos::stop_recording_macos,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(target_os = "macos"))]
fn run_app() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AuthState(std::sync::Arc::new(
            std::sync::atomic::AtomicBool::new(false),
        )))
        .manage(UploaderState::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .invoke_handler(tauri::generate_handler![
            auth::verify_admin,
            auth::is_authenticated,
            auth::get_config,
            recorder::start_recording,
            recorder::stop_recording,
            recorder_windows::init_recording,
            recorder_windows::upload_chunk,
            recorder_windows::finalize_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
