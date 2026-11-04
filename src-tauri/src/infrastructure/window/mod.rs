//! The main window as a quick note: its opacity and its buttons, and the app that was in front
//! before it, which each system reaches its own way. When the window shows, resizes and hides is
//! the interface's (`interfaces/tauri/quick_note.rs`).

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub(crate) use macos::{activate, front_app, set_buttons_hidden, set_opacity, AppId};

/// Whether the quick note is built on this system: its global shortcut and tray item.
pub(crate) const QUICK_NOTE_BUILT: bool = cfg!(target_os = "macos");

// Not built elsewhere yet: nothing starts a quick note there, so these are never reached.

#[cfg(not(target_os = "macos"))]
#[derive(Clone, Copy, Debug)]
pub(crate) struct AppId;

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_opacity(_window: &tauri::WebviewWindow, _opacity: f64) {}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_buttons_hidden(_window: &tauri::WebviewWindow, _hidden: bool) {}

#[cfg(not(target_os = "macos"))]
pub(crate) fn front_app() -> Option<AppId> {
    None
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn activate(_app: AppId) -> bool {
    false
}
