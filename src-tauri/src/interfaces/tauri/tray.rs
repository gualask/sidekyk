//! The tray icon's entry points: a click shows the window; the menu shows it, starts a capture or
//! opens a quick note (where they are built), or quits. While the icon is there, closing the
//! window only hides it.

use tauri::AppHandle;

use crate::desktop::{capture, quick_note, window};

/// A click on the icon, or the menu's Show.
pub(crate) fn show(app: &AppHandle) {
    window::show(app);
}

/// The menu's Capture.
pub(crate) fn capture(app: &AppHandle) {
    capture::capture(app);
}

/// The menu's New Note.
pub(crate) fn note(app: &AppHandle) {
    quick_note::toggle(app);
}

/// The menu's Quit.
pub(crate) fn quit(app: &AppHandle) {
    app.exit(0);
}
