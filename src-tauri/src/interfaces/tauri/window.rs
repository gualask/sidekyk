//! The main window: what its page knows about it, and showing and hiding it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use super::state::ProjectsState;
use super::tray;

/// If the page never says it painted (a script that failed to load), the window shows anyway
/// after this long, rather than leave the app running with nothing on screen.
const FIRST_SHOW_DEADLINE: Duration = Duration::from_secs(3);

/// The window is created hidden (`visible: false` in `tauri.conf.json`) and shows once its page
/// painted, so startup shows no blank frame.
pub(crate) struct FirstShow {
    started: Instant,
    done: AtomicBool,
}

impl Default for FirstShow {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            done: AtomicBool::new(false),
        }
    }
}

#[tauri::command]
/// The page painted its first frame: the window, created hidden, shows. Only the first call
/// counts, so a page loaded again (a crashed webview) does not show a window closed into the tray.
pub(crate) fn show_window(app: AppHandle) {
    show_first(&app);
}

/// Shows the window at the deadline if nothing showed it before.
pub(crate) fn show_by_deadline(app: &AppHandle) {
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("first-show".to_string())
        .spawn(move || {
            std::thread::sleep(FIRST_SHOW_DEADLINE);
            if show_first(&handle) {
                tracing::warn!("the page did not paint in time: the window showed anyway");
            }
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "no deadline for the first show: showing the window now");
        show_main_window(app);
    }
}

#[tauri::command]
/// The window was minimized, hidden or covered, or shows again: the page's visibility, which
/// every platform's webview keeps. Showing again answers with the project on screen when its
/// files or refs changed meanwhile.
pub(crate) fn set_window_visible(app: tauri::AppHandle, visible: bool) -> Option<String> {
    app.state::<ProjectsState>().set_window_visible(visible)
}

/// Shows the window if nothing showed it yet, and says whether it did.
fn show_first(app: &AppHandle) -> bool {
    let first = record_show(app);
    if first {
        bring_back(app);
    }
    first
}

/// Brings the window back, minimized, hidden or behind others; the first time, also at startup.
pub(crate) fn show_main_window(app: &AppHandle) {
    record_show(app);
    bring_back(app);
}

/// Records that the window shows, and the time from startup the first time: true only then.
fn record_show(app: &AppHandle) -> bool {
    let first_show = app.state::<FirstShow>();
    let first = !first_show.done.swap(true, Ordering::Relaxed);
    if first {
        tracing::info!(
            ms = first_show.started.elapsed().as_millis(),
            "window shown"
        );
    }
    first
}

/// The global shortcut and `sidekyk --toggle`: the window in front hides; minimized, hidden or
/// behind others, it comes back to the front.
pub(crate) fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let in_front = window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && window.is_focused().unwrap_or(false);
    if in_front {
        hide_main_window(app);
    } else {
        show_main_window(app);
    }
}

/// macOS hides the whole app, so the app used before comes back to the front; a window hidden
/// alone would leave Sidekyk active with nothing on screen.
#[cfg(target_os = "macos")]
fn hide_main_window(app: &AppHandle) {
    let _ = app.hide();
}

/// Elsewhere the window hides and the system brings the next one to the front.
#[cfg(not(target_os = "macos"))]
fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn bring_back(app: &AppHandle) {
    // the app hidden by the shortcut shows again with its window
    #[cfg(target_os = "macos")]
    let _ = app.show();
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
