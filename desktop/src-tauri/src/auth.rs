use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

pub struct AuthState(pub Arc<AtomicBool>);

#[tauri::command]
pub fn verify_admin(
    username: String,
    password: String,
    state: State<AuthState>,
) -> bool {
    let expected_user = std::env::var("ADMIN_USERNAME").unwrap_or_default();
    let expected_pass = std::env::var("ADMIN_PASSWORD").unwrap_or_default();

    // Constant-time comparison using XOR fold to prevent early exit
    let user_ok = constant_time_eq(username.as_bytes(), expected_user.as_bytes());
    let pass_ok = constant_time_eq(password.as_bytes(), expected_pass.as_bytes());

    let ok = user_ok & pass_ok;
    if ok {
        state.0.store(true, Ordering::SeqCst);
    }
    ok
}

#[tauri::command]
pub fn is_authenticated(state: State<AuthState>) -> bool {
    state.0.load(Ordering::SeqCst)
}

/// XOR-fold constant-time equality (no short-circuit, no timing leak on equal-length inputs).
/// Returns true only if both slices are equal in length AND content.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff: u8 = a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    diff == 0
}
