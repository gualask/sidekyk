//! The tray icon's entry points: a click shows the window; the menu shows it, starts a capture or
//! opens a quick note (where they are built), or quits. While the icon is there, closing the
//! window only hides it.

use tauri::AppHandle;

use crate::desktop::{capture, quick_note, window};
use crate::infrastructure::tray::TrayItem;

/// An item of the menu chosen.
pub(crate) fn chosen(app: &AppHandle, item: TrayItem) {
    match item {
        TrayItem::Show => window::show(app),
        TrayItem::Capture => capture::capture(app),
        TrayItem::Note => quick_note::toggle(app),
        TrayItem::Quit => app.exit(0),
    }
}

/// A click on the icon.
pub(crate) fn clicked(app: &AppHandle) {
    window::show(app);
}
