mod auth;
mod recorder;
mod recorder_windows;
mod uploader;

use auth::AuthState;
use uploader::UploaderState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
