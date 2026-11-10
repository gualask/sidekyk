//! The tray icon and its menu: show the window, start a capture or open a quick note (where they
//! are built), quit. What an item or a click does is the caller's; the labels come as values, in
//! the language in effect.

use std::panic::{catch_unwind, AssertUnwindSafe};

use tauri::image::Image;
use tauri::menu::{IsMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use super::capture::CAPTURE_BUILT;
use super::window::QUICK_NOTE_BUILT;

/// An item of the tray's menu.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TrayItem {
    Show,
    Capture,
    Note,
    Quit,
}

impl TrayItem {
    const ALL: [Self; 4] = [Self::Show, Self::Capture, Self::Note, Self::Quit];

    fn id(self) -> &'static str {
        match self {
            Self::Show => "show",
            Self::Capture => "capture",
            Self::Note => "note",
            Self::Quit => "quit",
        }
    }
}

/// The menu's labels, in the language in effect.
#[derive(Clone, Copy)]
pub(crate) struct TrayLabels {
    pub(crate) show: &'static str,
    pub(crate) capture: &'static str,
    pub(crate) note: &'static str,
    pub(crate) quit: &'static str,
}

impl TrayLabels {
    fn of(self, item: TrayItem) -> &'static str {
        match item {
            TrayItem::Show => self.show,
            TrayItem::Capture => self.capture,
            TrayItem::Note => self.note,
            TrayItem::Quit => self.quit,
        }
    }
}

/// What an item chosen, or a click on the icon, does.
pub(crate) struct TrayActions {
    pub(crate) item: fn(&AppHandle, TrayItem),
    pub(crate) click: fn(&AppHandle),
}

/// Managed once the icon is in the tray, which Tauri keeps until the app exits: its menu's items,
/// to speak another language.
struct Tray(Vec<(TrayItem, MenuItem<tauri::Wry>)>);

/// Puts the icon in the tray. On Linux, Tauri loads libayatana-appindicator3 (or
/// libappindicator3) at runtime and panics without it: the app then goes on with no tray.
pub(crate) fn start(app: &AppHandle, labels: TrayLabels, actions: TrayActions) {
    match catch_unwind(AssertUnwindSafe(|| build(app, labels, actions))) {
        Ok(Ok(tray)) => {
            app.manage(tray);
        }
        Ok(Err(error)) => tracing::warn!(error = %format!("{error:#}"), "no tray icon"),
        Err(_) => tracing::warn!("no tray icon: the system has no tray library"),
    }
}

/// Whether the icon is in the tray, to bring the window back once closed.
pub(crate) fn is_up(app: &AppHandle) -> bool {
    app.try_state::<Tray>().is_some()
}

/// Whether this system's menu has the item.
fn built(item: TrayItem) -> bool {
    match item {
        TrayItem::Show | TrayItem::Quit => true,
        TrayItem::Capture => CAPTURE_BUILT,
        TrayItem::Note => QUICK_NOTE_BUILT,
    }
}

fn build(app: &AppHandle, labels: TrayLabels, actions: TrayActions) -> tauri::Result<Tray> {
    let items = TrayItem::ALL
        .into_iter()
        .filter(|item| built(*item))
        .map(|item| {
            let entry = MenuItem::with_id(app, item.id(), labels.of(item), true, None::<&str>)?;
            Ok((item, entry))
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let entries: Vec<&dyn IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|(_, entry)| entry as &dyn IsMenuItem<tauri::Wry>)
        .collect();
    let menu = Menu::with_items(app, &entries)?;
    let TrayActions { item, click } = actions;
    TrayIconBuilder::new()
        .icon(icon(app))
        // drawn by macOS in the menu bar's colors; elsewhere the app's icon, in color
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Sidekyk")
        .menu(&menu)
        // a click shows the window and the right button opens the menu, on macOS and Windows; on
        // Linux the appindicator reports no clicks, so every click opens the menu
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let chosen = TrayItem::ALL
                .into_iter()
                .find(|candidate| candidate.id() == event.id.as_ref());
            if let Some(chosen) = chosen {
                item(app, chosen);
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                click(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(Tray(items))
}

/// A monochrome glyph on macOS, where the menu bar wants a template; the app's icon elsewhere.
fn icon(app: &AppHandle) -> Image<'static> {
    let glyph = tauri::include_image!("icons/tray-template.png");
    if cfg!(target_os = "macos") {
        return glyph;
    }
    app.default_window_icon()
        .cloned()
        .map(Image::to_owned)
        .unwrap_or(glyph)
}

/// The menu in another language: queued on the main thread, where Tauri changes it anyway, so the
/// caller does not wait.
pub(crate) fn speak(app: &AppHandle, labels: TrayLabels) {
    if !is_up(app) {
        return;
    }
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        let tray = handle.state::<Tray>();
        let result = tray
            .0
            .iter()
            .try_for_each(|(item, entry)| entry.set_text(labels.of(*item)));
        if let Err(error) = result {
            tracing::warn!(%error, "could not update the tray menu");
        }
    });
    if let Err(error) = queued {
        tracing::warn!(%error, "could not queue the tray menu's update");
    }
}
