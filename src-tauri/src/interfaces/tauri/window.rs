//! The main window's commands: its page painted, or shows or hides (`desktop/window.rs`).

use tauri::{AppHandle, Manager};

use crate::desktop::window;
use sidekyk_core::app::projects::Projects;

#[tauri::command]
/// The page painted its first frame: the window, created hidden, shows. Only the first call
/// counts, so a page loaded again (a crashed webview) does not show a window closed into the tray.
pub(crate) fn show_window(app: AppHandle) {
    window::painted(&app);
}

#[tauri::command]
/// The window was minimized, hidden or covered, or shows again: the page's visibility, which
/// every platform's webview keeps. Showing again answers with the id of the project on screen
/// when its files or refs changed meanwhile.
pub(crate) fn set_window_visible(app: AppHandle, visible: bool) -> Option<String> {
    // rare, and what tells whether a platform's webview reports it (docs/testing.md)
    tracing::info!(visible, "window visibility");
    app.state::<Projects>().set_visible(visible)
}
