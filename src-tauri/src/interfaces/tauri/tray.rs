//! The tray icon: how many files changed in the project on screen, and a menu to show the window
//! or quit. While it is there, closing the window only hides it.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use super::state::ProjectsState;
use super::texts::Texts;
use super::window::show_main_window;
use sidekyk_core::modules::repository::RepositorySummary;
use sidekyk_core::shared::sync::lock;

const SHOW: &str = "show";
const QUIT: &str = "quit";

/// Managed once the icon is in the tray.
struct Tray {
    icon: TrayIcon,
    show: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    /// What the icon shows, so a read that changed nothing touches nothing. Only the main thread,
    /// where every update runs, uses it.
    showing: Mutex<Showing>,
}

/// What the icon shows, and in which language.
struct Showing {
    shown: Option<Shown>,
    texts: &'static Texts,
}

/// The project on screen, as the tray shows it.
#[derive(Debug, PartialEq)]
struct Shown {
    name: String,
    files: u32,
    /// There are more changed files than were read.
    more: bool,
}

/// Puts the icon in the tray. On Linux, Tauri loads libayatana-appindicator3 (or
/// libappindicator3) at runtime and panics without it: the app then goes on with no tray.
pub(crate) fn start(app: &AppHandle, texts: &'static Texts) {
    match catch_unwind(AssertUnwindSafe(|| build(app, texts))) {
        Ok(Ok((icon, show, quit))) => {
            app.manage(Tray {
                icon,
                show,
                quit,
                showing: Mutex::new(Showing { shown: None, texts }),
            });
        }
        Ok(Err(error)) => tracing::warn!(error = %format!("{error:#}"), "no tray icon"),
        Err(_) => tracing::warn!("no tray icon: the system has no tray library"),
    }
}

/// Whether the icon is in the tray, to bring the window back once closed.
pub(crate) fn is_up(app: &AppHandle) -> bool {
    app.try_state::<Tray>().is_some()
}

type Built = (TrayIcon, MenuItem<tauri::Wry>, MenuItem<tauri::Wry>);

fn build(app: &AppHandle, texts: &Texts) -> tauri::Result<Built> {
    let show = MenuItem::with_id(app, SHOW, texts.show, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, texts.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = TrayIconBuilder::new()
        .icon(icon(app))
        // drawn by macOS in the menu bar's colors; elsewhere the app's icon, in color
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Sidekyk")
        .menu(&menu)
        // As each system does: on Windows a click shows the window and the right button the menu;
        // on macOS a click opens the menu; on Linux every click opens it.
        .show_menu_on_left_click(!cfg!(windows))
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW => show_main_window(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(windows) {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            }
        })
        .build(app)?;
    Ok((icon, show, quit))
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

/// Shows a read of a project in the tray, when it is the project on screen: how many files
/// changed, next to the icon on macOS and Linux and in its tooltip everywhere. A read that failed
/// (a repository moved away) clears it.
pub(crate) fn show_read(app: &AppHandle, project_id: &str, summary: Option<&RepositorySummary>) {
    let Some(active) = app.state::<ProjectsState>().active() else {
        return;
    };
    if active.id == project_id {
        show(
            app,
            summary.map(|summary| Shown {
                name: active.name,
                files: summary.totals.files,
                more: summary.truncated,
            }),
        );
    }
}

/// Clears the count, until the project now on screen is read.
pub(crate) fn clear(app: &AppHandle) {
    show(app, None);
}

/// Updates the icon on the main thread, where Tauri changes it anyway: the caller does not wait,
/// and updates apply in the order they were asked for.
fn show(app: &AppHandle, next: Option<Shown>) {
    on_main_thread(app, move |tray, showing| {
        if showing.shown != next {
            let texts = showing.texts;
            set_label(tray, showing, next, texts);
        }
    });
}

/// The menu and the tooltip in another language, from the settings just changed.
pub(crate) fn speak(app: &AppHandle, texts: &'static Texts) {
    on_main_thread(app, move |tray, showing| {
        if std::ptr::eq(showing.texts, texts) {
            return;
        }
        let result = tray
            .show
            .set_text(texts.show)
            .and_then(|()| tray.quit.set_text(texts.quit));
        if let Err(error) = result {
            tracing::warn!(%error, "could not update the tray menu");
        }
        let shown = showing.shown.take();
        set_label(tray, showing, shown, texts);
    });
}

fn on_main_thread(app: &AppHandle, update: impl FnOnce(&Tray, &mut Showing) + Send + 'static) {
    if !is_up(app) {
        return;
    }
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        let tray = handle.state::<Tray>();
        update(&tray, &mut lock(&tray.showing));
    });
    if let Err(error) = queued {
        tracing::warn!(%error, "could not update the tray icon");
    }
}

fn set_label(tray: &Tray, showing: &mut Showing, next: Option<Shown>, texts: &'static Texts) {
    let (title, tooltip) = label(next.as_ref(), texts);
    let result = tray
        .icon
        .set_title(title)
        .and_then(|()| tray.icon.set_tooltip(Some(tooltip)));
    match result {
        Ok(()) => {
            tracing::debug!(files = next.as_ref().map(|shown| shown.files), "tray");
            *showing = Showing { shown: next, texts };
        }
        Err(error) => tracing::warn!(%error, "could not update the tray icon"),
    }
}

/// The text next to the icon, none without changes, and the tooltip.
fn label(shown: Option<&Shown>, texts: &Texts) -> (Option<String>, String) {
    let Some(Shown { name, files, more }) = shown else {
        return (None, "Sidekyk".to_string());
    };
    let count = format!("{files}{}", if *more { "+" } else { "" });
    let changes = match (files, more) {
        (0, _) => texts.no_changes.to_string(),
        (1, false) => texts.one_changed_file.to_string(),
        _ => texts.changed_files.replace("{count}", &count),
    };
    (
        (*files > 0).then_some(count),
        format!("Sidekyk · {name}: {changes}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interfaces::tauri::texts;
    use sidekyk_core::modules::settings::Language;

    fn shown(files: u32) -> Option<Shown> {
        Some(Shown {
            name: "shop".to_string(),
            files,
            more: false,
        })
    }

    fn label(shown: Option<&Shown>) -> (Option<String>, String) {
        super::label(shown, texts::texts(None))
    }

    #[test]
    fn the_count_shows_only_with_changes() {
        assert_eq!(label(None), (None, "Sidekyk".to_string()));
        assert_eq!(
            label(shown(0).as_ref()),
            (None, "Sidekyk · shop: no changes".to_string())
        );
        assert_eq!(
            label(shown(1).as_ref()),
            (
                Some("1".to_string()),
                "Sidekyk · shop: 1 changed file".to_string()
            )
        );
        assert_eq!(
            label(shown(12).as_ref()),
            (
                Some("12".to_string()),
                "Sidekyk · shop: 12 changed files".to_string()
            )
        );
        let more = Shown {
            more: true,
            ..shown(10_000).unwrap()
        };
        assert_eq!(
            label(Some(&more)),
            (
                Some("10000+".to_string()),
                "Sidekyk · shop: 10000+ changed files".to_string()
            )
        );
    }

    #[test]
    fn the_tooltip_speaks_the_settings_language() {
        let italian = texts::texts(Some(Language::It));
        assert_eq!(
            super::label(shown(1).as_ref(), italian).1,
            "Sidekyk · shop: 1 file modificato"
        );
        assert_eq!(
            super::label(shown(12).as_ref(), italian).1,
            "Sidekyk · shop: 12 file modificati"
        );
    }
}
