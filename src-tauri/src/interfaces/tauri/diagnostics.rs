//! Errors the frontend reports, kept in the same log as the backend's, and what the settings tell
//! about the app: its version, its log.

use sidekyk_core::shared::error::AppError;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use super::blocking::blocking;
use crate::infrastructure::logging;

/// Longer messages (a stack trace) are cut, so one report cannot flood the log.
const MAX_MESSAGE_CHARS: usize = 4_000;

fn bounded(message: &str) -> &str {
    message
        .char_indices()
        .nth(MAX_MESSAGE_CHARS)
        .map_or(message, |(end, _)| &message[..end])
}

#[tauri::command]
/// An uncaught error or rejected promise in the frontend.
pub(crate) fn log_frontend_error(message: String) {
    tracing::error!(message = bounded(&message), "frontend error");
}

#[tauri::command]
/// The app's version, as its bundle has it.
pub(crate) fn get_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
/// This session's log selected in the system's file manager, the previous session's beside it:
/// for a bug report.
pub(crate) async fn reveal_log(app: tauri::AppHandle) -> Result<(), AppError> {
    blocking("reveal_log", app, |app| {
        let file = logging::session_file(&app.path().app_log_dir()?);
        app.opener().reveal_item_in_dir(file)?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_messages_are_cut_on_a_character_boundary() {
        assert_eq!(bounded("short"), "short");
        let long = "è".repeat(MAX_MESSAGE_CHARS + 10);
        assert_eq!(bounded(&long).chars().count(), MAX_MESSAGE_CHARS);
    }
}
