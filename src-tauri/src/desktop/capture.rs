//! The capture session: started from the global shortcut, the tray, Notes or the capture window,
//! one at a time, with where it goes (`CaptureInto`); each area taken is a crop held by its id
//! until a note takes it or its draft drops it, and opens the capture window (or joins it, open);
//! the area last taken shows picked at the next capture on its display. Built where
//! `CAPTURE_BUILT`.

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};

use super::{compact_window, texts, window};
use crate::infrastructure::capture as system;
pub(crate) use crate::infrastructure::capture::{CAPTURE_BUILT, SETTINGS_URL};
use sidekyk_core::modules::capture::{CaptureEvent, CaptureInto, Outcome, Taken, CAPTURE_EVENT};
use sidekyk_core::modules::notes::PreparedImage;
use sidekyk_core::shared::id::new_id;
use sidekyk_core::shared::sync::lock;

#[derive(Default)]
pub(crate) struct CaptureSession {
    /// The crops taken, by id, until a note takes them or their draft drops them.
    crops: Mutex<Vec<(String, Arc<PreparedImage>)>>,
    /// A capture is on, from its start until it ends, and where it goes: another start is
    /// ignored.
    on: Mutex<Option<CaptureInto>>,
    /// The area last taken, picked again at the next capture on its display.
    last: Mutex<Option<Taken>>,
}

/// Starts a capture of the display under the pointer, for `into`; one already on is left alone.
/// The quick note open gives way; the capture window open stays, for the crop to join its draft.
pub(crate) fn capture(app: &AppHandle, into: CaptureInto) {
    let session = app.state::<CaptureSession>();
    {
        let mut on = lock(&session.on);
        // rare, a press of the user's: kept, so a capture that never ends (ScreenCaptureKit
        // silent) shows in the log as every press after it
        if on.is_some() {
            tracing::info!("a capture is already on: this one ignored");
            return;
        }
        *on = Some(into);
    }
    compact_window::close_for_capture(app);
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

/// The crops `ids` names, in their order: all of them, or an error naming one gone.
pub(crate) fn crops(app: &AppHandle, ids: &[String]) -> anyhow::Result<Vec<Arc<PreparedImage>>> {
    let session = app.state::<CaptureSession>();
    let crops = lock(&session.crops);
    ids.iter()
        .map(|id| {
            crops
                .iter()
                .find(|(crop, _)| crop == id)
                .map(|(_, image)| Arc::clone(image))
                .ok_or_else(|| anyhow::anyhow!("no crop {id}"))
        })
        .collect()
}

/// Drops the crops `ids`: a note took them, or their draft let them go.
pub(crate) fn drop_crops(app: &AppHandle, ids: &[String]) {
    lock(&app.state::<CaptureSession>().crops).retain(|(crop, _)| !ids.contains(crop));
}

/// A page loaded again (a crashed webview) holds no draft: its crops go.
pub(crate) fn forget(app: &AppHandle) {
    lock(&app.state::<CaptureSession>().crops).clear();
}

fn ended(app: &AppHandle, outcome: Outcome) {
    let session = app.state::<CaptureSession>();
    let into = lock(&session.on).take().unwrap_or(CaptureInto::Last);
    match outcome {
        Outcome::Captured { image, taken } => {
            *lock(&session.last) = Some(taken);
            let crop = new_id();
            let size = (image.width, image.height);
            lock(&session.crops).push((crop.clone(), Arc::new(image)));
            // the page has the crop before its window shows
            emit(
                app,
                CaptureEvent::Taken {
                    crop,
                    width: size.0,
                    height: size.1,
                    into,
                },
            );
            compact_window::open_capture(app, size, taken.display);
        }
        Outcome::Cancelled => tracing::debug!("capture cancelled"),
        Outcome::NoPermission => {
            tracing::info!("capture refused: no Screen Recording permission");
            window::show(app);
            emit(app, CaptureEvent::Refused);
        }
        Outcome::Failed(error) => {
            tracing::warn!(error = %format!("{error:#}"), "capture failed");
            window::show(app);
            emit(app, CaptureEvent::Failed);
        }
    }
}

/// Tells the frontend how a capture ended; a cancel tells nothing.
fn emit(app: &AppHandle, event: CaptureEvent) {
    if let Err(error) = app.emit(CAPTURE_EVENT, event) {
        tracing::warn!(%error, "could not tell how the capture ended");
    }
}
