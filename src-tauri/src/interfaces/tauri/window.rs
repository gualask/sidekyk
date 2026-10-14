//! Tauri adapter for what the window's page knows about the window.

use tauri::Manager;

use super::state::ProjectsState;

#[tauri::command]
/// The window was minimized, hidden or covered, or shows again: the page's visibility, which
/// every platform's webview keeps. Showing again answers with the project on screen when its
/// files or refs changed meanwhile.
pub(crate) fn set_window_visible(app: tauri::AppHandle, visible: bool) -> Option<String> {
    app.state::<ProjectsState>().set_window_visible(visible)
}
