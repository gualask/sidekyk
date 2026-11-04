//! macOS: the window's opacity and buttons through its `NSWindow`, the app in front through
//! `NSWorkspace`.

use objc2_app_kit::{
    NSApplicationActivationOptions, NSRunningApplication, NSWindow, NSWindowButton, NSWorkspace,
};
use tauri::WebviewWindow;

/// An app running, by its process.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AppId(i32);

/// Changes the window's `NSWindow` on the main thread, after the calls queued before it (Tauri
/// queues its own there too, such as a resize or a show).
fn on_window(window: &WebviewWindow, change: impl FnOnce(&NSWindow) + Send + 'static) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    let pointer = pointer as usize;
    let queued = window.run_on_main_thread(move || {
        // SAFETY: Tauri's `NSWindow` of a window that lives as long as the app, read on the main
        // thread
        let ns_window = unsafe { &*(pointer as *const NSWindow) };
        change(ns_window);
    });
    if let Err(error) = queued {
        tracing::warn!(%error, "could not reach the window");
    }
}

/// 0 leaves the window on screen but unseen, 1 opaque.
pub(crate) fn set_opacity(window: &WebviewWindow, opacity: f64) {
    on_window(window, move |ns_window| ns_window.setAlphaValue(opacity));
}

/// The traffic lights, which the quick note has none of.
pub(crate) fn set_buttons_hidden(window: &WebviewWindow, hidden: bool) {
    on_window(window, move |ns_window| {
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.setHidden(hidden);
            }
        }
    });
}

/// The app in front now.
pub(crate) fn front_app() -> Option<AppId> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    Some(AppId(app.processIdentifier()))
}

/// Brings an app to the front, if it still runs; whether it was asked to.
pub(crate) fn activate(app: AppId) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(app.0)
        .is_some_and(|running| running.activateWithOptions(NSApplicationActivationOptions::empty()))
}
