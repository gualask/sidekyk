//! Tauri adapters for the settings.

use tauri::Manager;

use super::blocking::blocking;
use super::texts::{self, Texts};
use super::{shortcut, tray};
use crate::infrastructure::settings_store;
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::settings::{Language, Settings, Theme};
use sidekyk_core::shared::error::AppError;

/// The window's theme for a setting. The pages follow it too: a webview's
/// `prefers-color-scheme` is the theme of its window.
pub(crate) fn window_theme(theme: Theme) -> tauri::Theme {
    match theme {
        Theme::Dark => tauri::Theme::Dark,
        Theme::Light => tauri::Theme::Light,
    }
}

/// What the backend writes for the user, in the language of the settings: the tray (once it is
/// up), the first list of a project read from now on. Dialogs and exports read it as they open.
pub(crate) fn apply_language(app: &tauri::AppHandle, language: Option<Language>) -> &'static Texts {
    let texts = texts::texts(language);
    app.state::<NotesStore>().name_first_lists(texts.first_list);
    tray::speak(app, texts);
    texts
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
        apply_language(app, settings.language);
        if let Err(error) = settings_store::save_settings(app, &settings) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the settings");
        }
        Ok(settings)
    })
    .await
}
