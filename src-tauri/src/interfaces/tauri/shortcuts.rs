//! The global shortcuts' entry points: what a press does, and the settings page's commands
//! (`infrastructure/global_shortcuts/` registers them on each system).

use tauri::AppHandle;

use crate::desktop::{capture, quick_note, settings, window};
use sidekyk_core::modules::settings::{GlobalShortcutStatuses, ShortcutAction};

/// A global shortcut pressed, from any app.
pub(crate) fn pressed(app: &AppHandle, action: ShortcutAction) {
    match action {
        ShortcutAction::Toggle => window::toggle(app),
        ShortcutAction::Capture => capture::capture(app),
        ShortcutAction::Note => quick_note::toggle(app),
    }
}

#[tauri::command]
/// Where each global shortcut stands, from memory. Async, so off the main thread: a change of
/// the settings holds the state while the main thread registers its shortcut.
pub(crate) async fn get_global_shortcut_status(app: AppHandle) -> GlobalShortcutStatuses {
    settings::shortcut_status(&app)
}

#[tauri::command]
/// A new shortcut is being typed in the settings, or no longer is.
pub(crate) fn set_shortcut_recording(app: AppHandle, recording: bool) {
    settings::set_shortcut_recording(&app, recording);
}
