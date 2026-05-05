use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

pub struct AuthState(pub Arc<AtomicBool>);

#[tauri::command]
pub fn verify_admin(
    username: String,
    password: String,
    state: State<AuthState>,
) -> Result<bool, String> {
    let expected_user = std::env::var("ADMIN_USERNAME")
        .map_err(|_| "ADMIN_USERNAME is not configured".to_string())?;
    let expected_pass = std::env::var("ADMIN_PASSWORD")
        .map_err(|_| "ADMIN_PASSWORD is not configured".to_string())?;

    // XOR-fold comparison: no short-circuit on content, constant time for equal-length inputs.
    // Note: length difference is still observable via timing; acceptable for a local single-admin app.
    let user_ok = constant_time_eq(username.as_bytes(), expected_user.as_bytes());
    let pass_ok = constant_time_eq(password.as_bytes(), expected_pass.as_bytes());

    let ok = user_ok & pass_ok;
    if ok {
        state.0.store(true, Ordering::SeqCst);
    }
    Ok(ok)
}

#[tauri::command]
pub fn is_authenticated(state: State<AuthState>) -> bool {
    state.0.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn get_config(key: String) -> Result<String, String> {
    std::env::var(&key).map_err(|_| format!("{} is not configured", key))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff: u8 = a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    diff == 0
}
