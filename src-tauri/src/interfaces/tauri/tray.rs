//! The tray icon: it tells the app runs while its window is hidden. A click shows the window, the
//! menu shows it or quits. While it is there, closing the window only hides it.

use std::panic::{catch_unwind, AssertUnwindSafe};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use super::texts::Texts;
use super::window::show_main_window;

const SHOW: &str = "show";
const QUIT: &str = "quit";

/// Managed once the icon is in the tray, which Tauri keeps until the app exits: its menu's items,
/// to speak another language.
struct Tray {
    show: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

/// Puts the icon in the tray. On Linux, Tauri loads libayatana-appindicator3 (or
/// libappindicator3) at runtime and panics without it: the app then goes on with no tray.
pub(crate) fn start(app: &AppHandle, texts: &'static Texts) {
    match catch_unwind(AssertUnwindSafe(|| build(app, texts))) {
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

fn build(app: &AppHandle, texts: &Texts) -> tauri::Result<Tray> {
    let show = MenuItem::with_id(app, SHOW, texts.show, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, texts.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::new()
        .icon(icon(app))
        // drawn by macOS in the menu bar's colors; elsewhere the app's icon, in color
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Sidekyk")
        .menu(&menu)
        // a click shows the window and the right button opens the menu, on macOS and Windows; on
        // Linux the appindicator reports no clicks, so every click opens the menu
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW => show_main_window(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(Tray { show, quit })
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

/// The menu in another language, from the settings just changed: queued on the main thread, where
/// Tauri changes it anyway, so the caller does not wait.
pub(crate) fn speak(app: &AppHandle, texts: &'static Texts) {
    if !is_up(app) {
        return;
    }
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        let tray = handle.state::<Tray>();
        let result = tray
            .show
            .set_text(texts.show)
            .and_then(|()| tray.quit.set_text(texts.quit));
        if let Err(error) = result {
            tracing::warn!(%error, "could not update the tray menu");
        }
    });
    if let Err(error) = queued {
        tracing::warn!(%error, "could not queue the tray menu's update");
    }
}
