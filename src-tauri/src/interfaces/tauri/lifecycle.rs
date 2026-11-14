//! The app's own events: a page loading, a window closing, the system asking for the window.

use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Manager, RunEvent, Webview, Window, WindowEvent};

use crate::desktop::{capture, compact_window, settings, window};

/// A page loaded again (a crashed webview) forgets a shortcut its predecessor was recording, a
/// compact view it had open and its draft's crops; logged, so a second load of a webview tells a crash.
pub(crate) fn page_loading(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if payload.event() == PageLoadEvent::Started {
        tracing::info!(webview = webview.label(), "page loading");
        settings::set_shortcut_recording(webview.app_handle(), false);
        compact_window::forget(webview.app_handle());
        capture::forget(webview.app_handle());
    }
}

/// A window's event: closing it.
pub(crate) fn window_event(window: &Window, event: &WindowEvent) {
    window::on_close(window, event);
}

/// The app's run loop: the Dock's icon clicked.
pub(crate) fn run_event(app: &AppHandle, event: RunEvent) {
    window::on_run_event(app, &event);
}
