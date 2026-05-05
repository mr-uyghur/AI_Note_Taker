mod auth;
mod recorder;

use auth::AuthState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AuthState(std::sync::Arc::new(
            std::sync::atomic::AtomicBool::new(false),
        )))
        .invoke_handler(tauri::generate_handler![
            auth::verify_admin,
            auth::is_authenticated,
            recorder::start_recording,
            recorder::stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
