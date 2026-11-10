//! The settings in effect, the one copy the app reads: the store only keeps them on disk. A change
//! applies only what differs from them: a sidebar dragged or long lines switched changes no theme,
//! language or shortcut, and sets none of them again (the theme goes to every window on Windows
//! and through GTK on Linux).

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use super::texts::{self, Texts};
use super::window::window_theme;
use crate::infrastructure::{global_shortcuts, settings_store, tray};
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::settings::{GlobalShortcutStatuses, Language, Settings};
use sidekyk_core::shared::sync::lock;

pub(crate) struct AppliedSettings(Mutex<Settings>);

impl AppliedSettings {
    /// The settings read at startup, applied right after.
    pub(crate) fn new(settings: Settings) -> Self {
        Self(Mutex::new(settings))
    }
}

/// Every setting, as in effect.
pub(crate) fn current(app: &AppHandle) -> Settings {
    lock(&app.state::<AppliedSettings>().0).clone()
}

/// What the backend writes for the user, in the language of the settings: the tray (once it is
/// up), the first list of a project read from now on. Dialogs and exports read it as they open.
pub(crate) fn apply_language(app: &AppHandle, language: Option<Language>) -> &'static Texts {
    let texts = texts::set(language);
    app.state::<NotesStore>().name_first_lists(texts.first_list);
    tray::speak(app, texts.tray());
    texts
}

/// Applies what changed of the settings at once and stores them; the same settings again do
/// nothing. A global shortcut the system turns down fails before anything changes; a failure to
/// store them leaves them applied for this session. Waits on the main thread (the shortcuts it
/// registers, the tray's text, the theme).
pub(crate) fn change(app: &AppHandle, settings: Settings) -> anyhow::Result<Settings> {
    let state = app.state::<AppliedSettings>();
    // held until stored, so changes reach the disk in the order they were applied
    let mut applied = lock(&state.0);
    if *applied == settings {
        return Ok(settings);
    }
    // their own check: one the system turned down is tried again at each change
    global_shortcuts::apply(app, &settings)?;
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
}

/// Where each global shortcut stands, from memory.
pub(crate) fn shortcut_status(app: &AppHandle) -> GlobalShortcutStatuses {
    global_shortcuts::status(app)
}

/// A new shortcut is being typed in the settings, or no longer is: pressing one does nothing
/// meanwhile.
pub(crate) fn set_shortcut_recording(app: &AppHandle, recording: bool) {
    global_shortcuts::set_recording(app, recording);
}
