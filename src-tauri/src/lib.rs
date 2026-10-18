//! Sidekyk's native backend (Tauri).

mod bootstrap;
mod infrastructure;
mod interfaces;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Boots the Tauri application through the composition root.
pub fn run() {
    bootstrap::run();
}
