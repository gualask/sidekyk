//! Capture: the display under the pointer read at its pixels, shown frozen and dimmed above
//! everything, an area picked over it (drawn, moved, resized, then confirmed) kept as a note's
//! image. Each system reads the display and shows the window its own way; the area's geometry
//! and how a drag changes it are the core's (`modules::capture`), one capture at a time and the
//! area last taken the session's (`desktop/capture.rs`).

#[cfg(target_os = "macos")]
mod macos;

use sidekyk_core::modules::capture::Area;
use sidekyk_core::modules::notes::PreparedImage;

/// Whether capture is built on this system: its tray item, global shortcut and Notes' button.
pub(crate) const CAPTURE_BUILT: bool = cfg!(target_os = "macos");

/// The system's settings where Sidekyk may be let read the screen: Privacy & Security, Screen
/// Recording.
pub(crate) const SETTINGS_URL: Option<&str> = if cfg!(target_os = "macos") {
    Some("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
} else {
    None
};

/// An area taken, on its display by the system's id.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Taken {
    pub(crate) display: u32,
    pub(crate) area: Area,
}

/// How a capture ended.
#[derive(Debug)]
pub(crate) enum Outcome {
    /// The area picked, ready for a note, and where it was.
    Captured {
        image: PreparedImage,
        taken: Taken,
    },
    /// `Esc`.
    Cancelled,
    /// The system does not let Sidekyk read the screen; it was asked to.
    NoPermission,
    Failed(anyhow::Error),
}

/// What a capture calls once it ends, on any thread.
pub(crate) type Done = Box<dyn FnOnce(Outcome) + Send>;

#[cfg(target_os = "macos")]
pub(crate) use macos::start;

/// Not built here yet: nothing offers it, so this is never reached.
#[cfg(not(target_os = "macos"))]
pub(crate) fn start(
    _app: &tauri::AppHandle,
    _confirm: &'static str,
    _last: Option<Taken>,
    done: Done,
) {
    tracing::debug!("capture is not built on this system yet");
    done(Outcome::Cancelled);
}
