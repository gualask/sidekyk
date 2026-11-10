//! The quick note's commands: the page says what it painted, or that the note is done
//! (`desktop/quick_note.rs`).

use tauri::AppHandle;

use crate::desktop::quick_note::{self, Then};

#[tauri::command]
/// The page painted the quick note: it shows.
pub(crate) fn quick_note_shown(app: AppHandle) {
    quick_note::shown(&app);
}

#[tauri::command]
/// The quick note is done, added or not (`↵`, `Esc`, a click outside): the window goes back.
pub(crate) fn close_quick_note(app: AppHandle) {
    quick_note::close(&app, Then::AsBefore);
}

#[tauri::command]
/// The page painted its layout again: the window shows it. A quick note opened meanwhile is left
/// alone.
pub(crate) fn quick_note_restored(app: AppHandle) {
    quick_note::restored(&app);
}
