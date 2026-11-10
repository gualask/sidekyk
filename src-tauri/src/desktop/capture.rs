//! The capture session: started from the global shortcut, the tray or Notes, one at a time; each
//! area taken waits here until the frontend, told it was taken, names the book it goes to (the
//! project on screen, or the Inbox); the area last taken shows picked at the next capture on its
//! display. Built where `CAPTURE_BUILT`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use super::{texts, window};
use crate::infrastructure::capture::{self as system, Outcome, Taken};
pub(crate) use crate::infrastructure::capture::{CAPTURE_BUILT, SETTINGS_URL};
use sidekyk_core::modules::capture::{CaptureEvent, CAPTURE_EVENT};
use sidekyk_core::modules::notes::PreparedImage;
use sidekyk_core::shared::sync::lock;

#[derive(Default)]
pub(crate) struct CaptureSession {
    /// The areas taken, in order, until notes take them: one for each `taken` told, so two
    /// captures in a row each find their own.
    pending: Mutex<VecDeque<PreparedImage>>,
    /// An image's marks are being edited: a capture, whose marks would open in their place,
    /// only shows the window.
    marking: AtomicBool,
    /// A capture is on, from its start until it ends: another start is ignored.
    on: AtomicBool,
    /// The area last taken, picked again at the next capture on its display.
    last: Mutex<Option<Taken>>,
}

/// Starts a capture of the display under the pointer; one already on is left alone. While marks
/// are edited, only shows the window.
pub(crate) fn capture(app: &AppHandle) {
    let session = app.state::<CaptureSession>();
    if session.marking.load(Ordering::Relaxed) {
        window::show(app);
        return;
    }
    if session.on.swap(true, Ordering::SeqCst) {
        tracing::debug!("a capture is already on");
        return;
    }
    let last = *lock(&session.last);
    let handle = app.clone();
    // the button's text, read apart from the settings' lock: this may run on the main thread
    let confirm = texts::current().capture;
    system::start(
        app,
        confirm,
        last,
        Box::new(move |outcome| ended(&handle, outcome)),
    );
}

/// The oldest area taken, for a note.
pub(crate) fn take_area(app: &AppHandle) -> anyhow::Result<PreparedImage> {
    lock(&app.state::<CaptureSession>().pending)
        .pop_front()
        .ok_or_else(|| anyhow::anyhow!("no capture to add"))
}

/// An image's marks open in Notes, or no longer are.
pub(crate) fn set_marking(app: &AppHandle, marking: bool) {
    app.state::<CaptureSession>()
        .marking
        .store(marking, Ordering::Relaxed);
}

fn ended(app: &AppHandle, outcome: Outcome) {
    let session = app.state::<CaptureSession>();
    session.on.store(false, Ordering::SeqCst);
    match outcome {
        Outcome::Captured { image, taken } => {
            *lock(&session.last) = Some(taken);
            lock(&session.pending).push_back(image);
            tell(app, CaptureEvent::Taken);
        }
        Outcome::Cancelled => tracing::debug!("capture cancelled"),
        Outcome::NoPermission => {
            tracing::info!("capture refused: no Screen Recording permission");
            tell(app, CaptureEvent::Refused);
        }
        Outcome::Failed(error) => {
            tracing::warn!(error = %format!("{error:#}"), "capture failed");
            tell(app, CaptureEvent::Failed);
        }
    }
}

/// Tells the frontend how a capture ended, the window shown for it; a cancel tells nothing.
fn tell(app: &AppHandle, event: CaptureEvent) {
    window::show(app);
    if let Err(error) = app.emit(CAPTURE_EVENT, event) {
        tracing::warn!(%error, "could not tell how the capture ended");
    }
}
