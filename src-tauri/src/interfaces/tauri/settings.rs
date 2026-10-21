//! Tauri adapters for the settings.

use std::sync::Mutex;

use tauri::Manager;

use super::blocking::blocking;
use super::texts::{self, Texts};
use super::{shortcut, tray};
use crate::infrastructure::settings_store;
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::settings::{Language, Settings, Theme};
use sidekyk_core::shared::error::AppError;
use sidekyk_core::shared::sync::lock;

/// The settings in effect, the one copy the app reads: the store only keeps them on disk. A
/// change applies only what differs from them: a sidebar dragged or long lines switched changes
/// no theme, language or shortcut, and sets none of them again (the theme goes to every window on
/// Windows and through GTK on Linux).
pub(crate) struct AppliedSettings(Mutex<Settings>);

impl AppliedSettings {
    /// The settings read at startup, applied right after.
    pub(crate) fn new(settings: Settings) -> Self {
        Self(Mutex::new(settings))
    }

    pub(crate) fn current(&self) -> Settings {
        lock(&self.0).clone()
    }
}

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
/// Every setting, as in effect.
pub(crate) fn get_settings(app: tauri::AppHandle) -> Settings {
    app.state::<AppliedSettings>().current()
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
        let state = app.state::<AppliedSettings>();
        // held until stored, so changes reach the disk in the order they were applied
        let mut applied = lock(&state.0);
        if *applied == settings {
            return Ok(settings);
        }
        // its own check: one the system turned down is tried again at each change
        shortcut::apply(app, &settings.global_shortcut)?;
        if settings.theme != applied.theme {
            app.set_theme(Some(window_theme(settings.theme)));
        }
        if settings.language != applied.language {
            apply_language(app, settings.language);
        }
        *applied = settings.clone();
        if let Err(error) = settings_store::save_settings(app, &settings) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the settings");
        }
        Ok(settings)
    })
    .await
}
