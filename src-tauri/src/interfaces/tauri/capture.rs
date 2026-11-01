//! Tauri adapter for capture: started from the global shortcut, the tray or Notes; each area
//! picked waits here until the frontend, told it was taken, names the book it goes to (the
//! project on screen, or the Inbox). Built where `infrastructure::capture::BUILT`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::notes::with_notes;
use super::window::show_main_window;
use crate::infrastructure::capture as system;
use sidekyk_core::modules::notes::{ImageTarget, Note, PreparedImage};
use sidekyk_core::shared::error::AppError;
use sidekyk_core::shared::sync::lock;

#[derive(Default)]
pub(crate) struct CaptureState {
    /// The areas picked, in order, until notes take them: one for each `taken` told, so two
    /// captures in a row each find their own.
    pending: Mutex<VecDeque<PreparedImage>>,
    /// An image's marks are being edited: a capture, whose marks would open in their place,
    /// only shows the window.
    marking: AtomicBool,
}

#[tauri::command]
/// Whether this system captures: Notes' button shows only then.
pub(crate) fn can_capture() -> bool {
    system::BUILT
}

#[tauri::command]
/// Starts a capture, as the global shortcut does: Notes' button.
pub(crate) fn start_capture(app: AppHandle) {
    capture(&app);
}

#[tauri::command]
/// Makes the oldest area picked a new note, on top of the book's open list.
pub(crate) async fn add_capture(app: AppHandle, book: String) -> Result<Note, AppError> {
    let image = lock(&app.state::<CaptureState>().pending)
        .pop_front()
        .ok_or_else(|| AppError::from(anyhow::anyhow!("no capture to add")))?;
    with_notes("add_capture", app, book, move |store, files, book| {
        let list = store.notes(files, book)?.open_list;
        store.add_images(files, book, ImageTarget::New { list }, vec![image])
    })
    .await
}

#[tauri::command]
/// An image's marks open in Notes, or no longer are.
pub(crate) fn set_marking(app: AppHandle, marking: bool) {
    app.state::<CaptureState>()
        .marking
        .store(marking, Ordering::Relaxed);
}

#[tauri::command]
/// Opens the system's settings where Sidekyk may be let read the screen.
pub(crate) fn open_capture_settings(app: AppHandle) -> Result<(), AppError> {
    if let Some(url) = system::SETTINGS_URL {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|error| AppError::from(anyhow::Error::from(error)))?;
    }
    Ok(())
}

/// Starts a capture of the display under the pointer; one already on is left alone. While marks
/// are edited, only shows the window.
pub(crate) fn capture(app: &AppHandle) {
    if app.state::<CaptureState>().marking.load(Ordering::Relaxed) {
        show_main_window(app);
        return;
    }
    platform::capture(app);
}

#[cfg(target_os = "macos")]
mod platform {
    use tauri::{AppHandle, Emitter, Manager};

    use super::CaptureState;
    use crate::infrastructure::capture::{self, Outcome};
    use crate::interfaces::tauri::texts;
    use crate::interfaces::tauri::window::show_main_window;
    use sidekyk_core::modules::capture::{CaptureEvent, CAPTURE_EVENT};
    use sidekyk_core::modules::notes::PreparedImage;
    use sidekyk_core::shared::sync::lock;

    pub(super) fn capture(app: &AppHandle) {
        let handle = app.clone();
        // the button's text, read apart from the settings' lock: this runs on the main thread
        let confirm = texts::current().capture;
        let queued = app.run_on_main_thread(move || {
            let app = handle.clone();
            let done = Box::new(move |outcome| ended(&app, outcome));
            if !capture::start(confirm, done) {
                tracing::debug!("a capture is already on");
            }
        });
        if let Err(error) = queued {
            tracing::warn!(%error, "could not start a capture");
        }
    }

    fn ended(app: &AppHandle, outcome: Outcome) {
        match outcome {
            Outcome::Captured(image) => tell(app, CaptureEvent::Taken, Some(image)),
            Outcome::Cancelled => tracing::debug!("capture cancelled"),
            Outcome::NoPermission => {
                tracing::info!("capture refused: no Screen Recording permission");
                tell(app, CaptureEvent::Refused, None);
            }
            Outcome::Failed(error) => {
                tracing::warn!(error = %format!("{error:#}"), "capture failed");
                tell(app, CaptureEvent::Failed, None);
            }
        }
    }

    /// Tells the frontend how a capture ended, the window shown for it; a cancel tells nothing.
    fn tell(app: &AppHandle, event: CaptureEvent, image: Option<PreparedImage>) {
        if let Some(image) = image {
            lock(&app.state::<CaptureState>().pending).push_back(image);
        }
        show_main_window(app);
        if let Err(error) = app.emit(CAPTURE_EVENT, event) {
            tracing::warn!(%error, "could not tell how the capture ended");
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::AppHandle;

    /// Not built here yet: nothing offers it.
    pub(super) fn capture(_app: &AppHandle) {
        tracing::debug!("capture is not built on this system yet");
    }
}
