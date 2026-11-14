//! The compact window's commands: the page says what it painted, or that its view is done
//! (`desktop/compact_window.rs`).

use tauri::AppHandle;

use crate::desktop::compact_window::{self, Then};

#[tauri::command]
/// The page painted the view: it shows.
pub(crate) fn compact_shown(app: AppHandle) {
    compact_window::shown(&app);
}

#[tauri::command]
/// The view is done, kept or not (`↵`, `Esc`, a click outside): the window goes back.
pub(crate) fn close_compact(app: AppHandle) {
    compact_window::close(&app, Then::AsBefore);
}

#[tauri::command]
/// The page painted its layout again: the window shows it. A view opened meanwhile is left alone.
pub(crate) fn compact_restored(app: AppHandle) {
    compact_window::restored(&app);
}
