//! Capture's commands: Notes' button, the area taken made a note, the marks open, the system's
//! permission (`desktop/capture.rs`).

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::blocking::with_notes;
use crate::desktop::capture::{self, CAPTURE_BUILT, SETTINGS_URL};
use sidekyk_core::modules::notes::Note;
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// Whether this system captures: Notes' button shows only then.
pub(crate) fn can_capture() -> bool {
    CAPTURE_BUILT
}

#[tauri::command]
/// Starts a capture, as the global shortcut does: Notes' button.
pub(crate) fn start_capture(app: AppHandle) {
    capture::capture(&app);
}

#[tauri::command]
/// Makes the oldest area taken a new note, on top of the book's open list.
pub(crate) async fn add_capture(app: AppHandle, book: String) -> Result<Note, AppError> {
    let image = capture::take_area(&app)?;
    with_notes("add_capture", app, book, move |store, files, book| {
        store.add_capture(files, book, image)
    })
    .await
}

#[tauri::command]
/// An image's marks open in Notes, or no longer are.
pub(crate) fn set_marking(app: AppHandle, marking: bool) {
    capture::set_marking(&app, marking);
}

#[tauri::command]
/// Opens the system's settings where Sidekyk may be let read the screen.
pub(crate) fn open_capture_settings(app: AppHandle) -> Result<(), AppError> {
    if let Some(url) = SETTINGS_URL {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|error| AppError::from(anyhow::Error::from(error)))?;
    }
    Ok(())
}
