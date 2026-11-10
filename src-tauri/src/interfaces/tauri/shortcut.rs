//! The global shortcuts' entry points: what a press does, and the settings page's commands
//! (`infrastructure/global_shortcuts/` registers them on each system).

use tauri::AppHandle;

use super::capture::capture;
use super::quick_note;
use super::window::toggle_main_window;
use crate::infrastructure::global_shortcuts;
use sidekyk_core::modules::settings::{GlobalShortcutStatuses, ShortcutAction};

/// `sidekyk --toggle`, run while Sidekyk runs, shows or hides its window like the shortcut.
pub(crate) const TOGGLE_FLAG: &str = "--toggle";

/// A global shortcut pressed, from any app.
pub(crate) fn pressed(app: &AppHandle, action: ShortcutAction) {
    match action {
        ShortcutAction::Toggle => toggle_main_window(app),
        ShortcutAction::Capture => capture(app),
        ShortcutAction::Note => quick_note::toggle(app),
    }
}

#[tauri::command]
/// Where each global shortcut stands, from memory. Async, so off the main thread: a change of
/// the settings holds the state while the main thread registers its shortcut.
pub(crate) async fn get_global_shortcut_status(app: AppHandle) -> GlobalShortcutStatuses {
    global_shortcuts::status(&app)
}

#[tauri::command]
/// A new shortcut is being typed in the settings, or no longer is.
pub(crate) fn set_shortcut_recording(app: AppHandle, recording: bool) {
    global_shortcuts::set_recording(&app, recording);
}
