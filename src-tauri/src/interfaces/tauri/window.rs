//! The main window: what its page knows about it, and showing and hiding it.

use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use super::state::ProjectsState;
use super::tray;

#[tauri::command]
/// The window was minimized, hidden or covered, or shows again: the page's visibility, which
/// every platform's webview keeps. Showing again answers with the project on screen when its
/// files or refs changed meanwhile.
pub(crate) fn set_window_visible(app: tauri::AppHandle, visible: bool) -> Option<String> {
    app.state::<ProjectsState>().set_window_visible(visible)
}

/// Brings the window back, minimized, hidden or behind others.
pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Closing the window hides it while the tray can bring it back; quitting is in the tray's menu
/// (and `⌘Q` on macOS). Without a tray, closing quits.
pub(crate) fn hide_on_close(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if tray::is_up(window.app_handle()) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

/// On macOS, a click on the Dock's icon brings back a window closed into the tray.
#[cfg(target_os = "macos")]
pub(crate) fn on_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::Reopen {
        has_visible_windows: false,
        ..
    } = event
    {
        show_main_window(app);
    }
}

/// Elsewhere the tray's menu (or launching the app again) brings it back.
#[cfg(not(target_os = "macos"))]
pub(crate) fn on_run_event(_app: &AppHandle, _event: RunEvent) {}
