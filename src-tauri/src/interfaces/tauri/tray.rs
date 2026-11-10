//! The tray icon's entry points: a click shows the window; the menu shows it, starts a capture or
//! opens a quick note (where they are built), or quits. While the icon is there, closing the
//! window only hides it.

use tauri::AppHandle;

use super::capture::capture;
use super::quick_note;
use super::window::show_main_window;
use crate::infrastructure::tray::TrayItem;

/// An item of the menu chosen.
pub(crate) fn chosen(app: &AppHandle, item: TrayItem) {
    match item {
        TrayItem::Show => show_main_window(app),
        TrayItem::Capture => capture(app),
        TrayItem::Note => quick_note::toggle(app),
        TrayItem::Quit => app.exit(0),
    }
}

/// A click on the icon.
pub(crate) fn clicked(app: &AppHandle) {
    show_main_window(app);
}
