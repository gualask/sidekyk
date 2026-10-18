//! Tauri adapters for the settings.

use super::blocking::blocking;
use super::shortcut;
use crate::infrastructure::settings_store;
use sidekyk_core::modules::settings::{Settings, Theme};
use sidekyk_core::shared::error::AppError;

/// The window's theme for a setting. The pages follow it too: a webview's
/// `prefers-color-scheme` is the theme of its window.
pub(crate) fn window_theme(theme: Theme) -> tauri::Theme {
    match theme {
        Theme::Dark => tauri::Theme::Dark,
        Theme::Light => tauri::Theme::Light,
    }
}

#[tauri::command]
/// Every setting, as stored.
pub(crate) fn get_settings(app: tauri::AppHandle) -> Settings {
    settings_store::load_settings(&app)
}

#[tauri::command]
/// Applies the settings at once and stores them. A global shortcut the system turns down fails
/// before anything changes; a failure to store them leaves them applied for this session.
pub(crate) async fn set_settings(
    app: tauri::AppHandle,
    settings: Settings,
) -> Result<Settings, AppError> {
    blocking("set_settings", app, move |app| {
        shortcut::apply(app, &settings.global_shortcut)?;
        app.set_theme(Some(window_theme(settings.theme)));
        if let Err(error) = settings_store::save_settings(app, &settings) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the settings");
        }
        Ok(settings)
    })
    .await
}
