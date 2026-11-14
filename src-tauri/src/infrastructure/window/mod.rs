//! The main window as each system shows and hides it: macOS hides the whole app and brings the
//! window back from the Dock, elsewhere the window alone hides. The window as a compact view: its
//! opacity and its buttons, the app that was in front before it, the display under the pointer or
//! a capture's. When the window shows,
//! resizes and hides is the session's (`desktop/window.rs`, `desktop/compact_window.rs`).

#[cfg(target_os = "macos")]
mod macos;

use tauri::{AppHandle, Manager, Monitor, RunEvent};

#[cfg(target_os = "macos")]
pub(crate) use macos::{activate, front_app, set_buttons_hidden, set_opacity, AppId};

/// Whether the quick note is built on this system: its global shortcut and tray item.
pub(crate) const QUICK_NOTE_BUILT: bool = cfg!(target_os = "macos");

/// The display under the pointer.
#[cfg(target_os = "macos")]
pub(crate) fn monitor_under_pointer(app: &AppHandle) -> Option<Monitor> {
    let (x, y) = macos::pointer();
    app.monitor_from_point(x, y).ok()?
}

/// Elsewhere `monitor_from_point` takes the physical pixels `cursor_position` gives.
#[cfg(not(target_os = "macos"))]
pub(crate) fn monitor_under_pointer(app: &AppHandle) -> Option<Monitor> {
    let pointer = app.cursor_position().ok()?;
    app.monitor_from_point(pointer.x, pointer.y).ok()?
}

/// The display `display`, by the system's id, as a capture gives it; the one under the pointer
/// when it is gone.
#[cfg(target_os = "macos")]
pub(crate) fn monitor_of(app: &AppHandle, display: u32) -> Option<Monitor> {
    let found = macos::display_middle(display)
        .and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten());
    found.or_else(|| monitor_under_pointer(app))
}

/// Capture is not built elsewhere yet, so no display id is known: the one under the pointer.
#[cfg(not(target_os = "macos"))]
pub(crate) fn monitor_of(app: &AppHandle, _display: u32) -> Option<Monitor> {
    monitor_under_pointer(app)
}

/// Hides Sidekyk. macOS hides the whole app, so the app used before comes back to the front; a
/// window hidden alone would leave Sidekyk active with nothing on screen.
#[cfg(target_os = "macos")]
pub(crate) fn hide(app: &AppHandle) {
    let _ = app.hide();
}

/// Elsewhere the window hides and the system brings the next one to the front.
#[cfg(not(target_os = "macos"))]
pub(crate) fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Shows the window and gives it the focus, minimized, hidden or behind others; on macOS the app
/// `hide` hid shows again with it.
pub(crate) fn bring_back(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Whether the system asks for the window back: on macOS, a click on the Dock's icon while no
/// window shows. Elsewhere the tray's menu, or launching the app again, does.
#[cfg(target_os = "macos")]
pub(crate) fn asks_for_window(event: &RunEvent) -> bool {
    matches!(
        event,
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        }
    )
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn asks_for_window(_event: &RunEvent) -> bool {
    false
}

// The quick note is not built elsewhere yet: nothing starts one there, so these are never reached.

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
