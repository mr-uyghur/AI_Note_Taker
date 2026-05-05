#[tauri::command]
pub async fn start_recording() -> Result<(), String> {
    // Stub: real recording pipeline is implemented in M4 (Windows) and M5 (macOS)
    Ok(())
}

#[tauri::command]
pub async fn stop_recording() -> Result<(), String> {
    // Stub: real recording pipeline is implemented in M4 (Windows) and M5 (macOS)
    Ok(())
}
