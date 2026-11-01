//! Capture: the display under the pointer read at its pixels, shown frozen and dimmed above
//! everything, an area picked over it (drawn, moved, resized, then confirmed) kept as a note's
//! image. Each system reads the display and shows the window its own way; the area's geometry
//! and how a drag changes it are the core's (`modules::capture`).

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub(crate) use macos::start;

/// Whether capture is built on this system: its tray item, global shortcut and Notes' button.
pub(crate) const BUILT: bool = cfg!(target_os = "macos");

/// The system's settings where Sidekyk may be let read the screen: Privacy & Security, Screen
/// Recording.
pub(crate) const SETTINGS_URL: Option<&str> = if cfg!(target_os = "macos") {
    Some("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
} else {
    None
};

/// How a capture ended.
#[cfg(target_os = "macos")]
#[derive(Debug)]
pub(crate) enum Outcome {
    /// The area picked, ready for a note.
    Captured(sidekyk_core::modules::notes::PreparedImage),
    /// `Esc`.
    Cancelled,
    /// The system does not let Sidekyk read the screen; it was asked to.
    NoPermission,
    Failed(anyhow::Error),
}

/// What a capture calls once it ends, on any thread.
#[cfg(target_os = "macos")]
pub(crate) type Done = Box<dyn FnOnce(Outcome) + Send>;
