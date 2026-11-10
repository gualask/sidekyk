//! The settings' commands (`desktop/settings.rs`).

use super::blocking::blocking;
use crate::desktop::settings;
use sidekyk_core::modules::settings::Settings;
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// Every setting, as in effect. Async, so off the main thread: a change of the settings holds
/// them while it waits on the main thread (the shortcuts it registers, the tray's text, the
/// theme), and a read there would wait for it in turn.
pub(crate) async fn get_settings(app: tauri::AppHandle) -> Settings {
    settings::current(&app)
}

#[tauri::command]
/// Applies what changed of the settings at once and stores them; the same settings again do
/// nothing. A global shortcut the system turns down fails before anything changes; a failure to
/// store them leaves them applied for this session.
pub(crate) async fn set_settings(
    app: tauri::AppHandle,
    settings: Settings,
) -> Result<Settings, AppError> {
    blocking("set_settings", app, move |app| {
        settings::change(app, settings)
    })
    .await
}
