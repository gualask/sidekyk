//! The main window: what its page knows about it, and showing and hiding it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use super::quick_note::{self, Then};
use crate::infrastructure::{tray, window as system};
use sidekyk_core::app::projects::Projects;

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
/// every platform's webview keeps. Showing again answers with the id of the project on screen
/// when its files or refs changed meanwhile.
pub(crate) fn set_window_visible(app: tauri::AppHandle, visible: bool) -> Option<String> {
    // rare, and what tells whether a platform's webview reports it (docs/testing.md)
    tracing::info!(visible, "window visibility");
    app.state::<Projects>().set_visible(visible)
}

/// Shows the window if nothing showed it yet, and says whether it did.
fn show_first(app: &AppHandle) -> bool {
    let first = record_show(app);
    if first {
        system::bring_back(app);
    }
    first
}

/// Brings the window back, minimized, hidden or behind others; the first time, also at startup.
/// A quick note open goes, the window staying in front with its layout.
pub(crate) fn show_main_window(app: &AppHandle) {
    if quick_note::close(app, Then::InFront) {
        return;
    }
    record_show(app);
    system::bring_back(app);
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
/// behind others, it comes back to the front. A quick note open gives way to the layout, in front.
pub(crate) fn toggle_main_window(app: &AppHandle) {
    if quick_note::close(app, Then::InFront) {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let in_front = window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && window.is_focused().unwrap_or(false);
    if in_front {
        system::hide(app);
    } else {
        show_main_window(app);
    }
}

/// Closing the window hides it while the tray can bring it back; quitting is in the tray's menu
/// (and `⌘Q` on macOS). Without a tray, closing quits. A quick note open only closes, as `Esc`.
pub(crate) fn hide_on_close(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if quick_note::close(window.app_handle(), Then::AsBefore) {
            api.prevent_close();
            return;
        }
        if tray::is_up(window.app_handle()) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

/// The system asks for the window back: on macOS, a click on the Dock's icon brings back a window
/// closed into the tray.
pub(crate) fn on_run_event(app: &AppHandle, event: RunEvent) {
    if system::asks_for_window(&event) {
        show_main_window(app);
    }
}
