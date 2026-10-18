//! Tauri composition root.
//!
//! Runtime plugins, managed state, and the stable inbound command list are wired here. Modules
//! and infrastructure services remain unaware of this composition root.

use std::path::{Path, PathBuf};

use ::tauri::webview::PageLoadEvent;
use ::tauri::{Emitter, Manager, WebviewWindowBuilder};

use crate::infrastructure::notes_files::NotesFiles;
use crate::infrastructure::{logging, settings_store};
use crate::interfaces::tauri as tauri_commands;
use crate::interfaces::tauri::settings::window_theme;
use crate::interfaces::tauri::shortcut::{self, TOGGLE_FLAG};
use crate::interfaces::tauri::state::{open_folder, watch_active, ProjectsState};
use crate::interfaces::tauri::tray;
use crate::interfaces::tauri::window::{
    hide_on_close, on_run_event, show_by_deadline, show_main_window, toggle_main_window, FirstShow,
};
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::projects::{ProjectsChangedEvent, PROJECTS_CHANGED_EVENT};
use sidekyk_core::modules::settings::Theme;

/// The first argument that is not a flag: `sidekyk ~/Dev/project` opens that repository.
fn folder_argument(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(PathBuf::from)
}

/// Creates the windows `tauri.conf.json` leaves to the app (`create: false`), already in the theme
/// of the settings: their first paint has the right colors, with no flash of the system's theme.
fn create_windows(app: &::tauri::AppHandle, theme: Theme) -> ::tauri::Result<()> {
    for config in app.config().app.windows.iter().filter(|w| !w.create) {
        WebviewWindowBuilder::from_config(app, config)?
            .theme(Some(window_theme(theme)))
            .build()?;
    }
    Ok(())
}

/// Adds and shows a repository named at launch; a failure leaves the app as it was.
fn open_or_log(app: &::tauri::AppHandle, folder: &Path) {
    match open_folder(app, folder) {
        Ok(_) => {
            let _ = app.emit(PROJECTS_CHANGED_EVENT, ProjectsChangedEvent::default());
        }
        Err(error) => tracing::warn!(
            folder = %folder.display(),
            error = %format!("{error:#}"),
            "could not open the repository"
        ),
    }
}

/// Boots the Tauri app and registers all commands/plugins.
pub(crate) fn run() {
    let builder = ::tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        if let Some(folder) = folder_argument(&args) {
            open_or_log(app, &PathBuf::from(cwd).join(folder));
            show_main_window(app);
        } else if args.iter().skip(1).any(|a| a == TOGGLE_FLAG) {
            toggle_main_window(app);
        } else {
            show_main_window(app);
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(ProjectsState::default())
        .manage(NotesStore::default())
        .manage(FirstShow::default())
        .setup(|app| {
            if let Ok(dir) = app.path().app_log_dir() {
                logging::init(&dir);
            }
            app.manage(NotesFiles::new(&app.path().app_data_dir()?));
            let settings = settings_store::load_settings(app.handle());
            // before the windows: their pages reach the shortcut's state as they load
            shortcut::start(app.handle(), &settings.global_shortcut);
            create_windows(app.handle(), settings.theme)?;
            show_by_deadline(app.handle());
            tray::start(app.handle());
            app.state::<ProjectsState>()
                .restore(settings_store::load_projects(app.handle()));
            let args: Vec<String> = std::env::args().collect();
            if let Some(folder) = folder_argument(&args) {
                open_or_log(app.handle(), &folder);
            }
            // the project on screen is watched even when the folder argument could not be opened;
            // a moved or deleted repository shows its error in the project's panels
            watch_active(app.handle());
            Ok(())
        })
        // a page loaded again (a crashed webview) forgets a shortcut its predecessor was recording
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                shortcut::set_recording(webview.app_handle(), false);
            }
        })
        .on_window_event(hide_on_close)
        .invoke_handler(::tauri::generate_handler![
            tauri_commands::projects::get_projects,
            tauri_commands::projects::add_project,
            tauri_commands::projects::activate_project,
            tauri_commands::projects::remove_project,
            tauri_commands::projects::set_project_layout,
            tauri_commands::projects::relocate_project,
            tauri_commands::repository::get_repository_snapshot,
            tauri_commands::repository::get_repository_summary,
            tauri_commands::repository::get_file_diff,
            tauri_commands::repository::get_recent_commits,
            tauri_commands::repository::get_commit_files,
            tauri_commands::repository::get_commit_file_diff,
            tauri_commands::repository::get_directory,
            tauri_commands::repository::get_file_content,
            tauri_commands::repository::get_syntax_colors,
            tauri_commands::notes::get_notes,
            tauri_commands::notes::add_note,
            tauri_commands::notes::set_note_text,
            tauri_commands::notes::set_note_done,
            tauri_commands::notes::place_note,
            tauri_commands::notes::restore_note,
            tauri_commands::notes::delete_note,
            tauri_commands::notes::add_note_list,
            tauri_commands::notes::rename_note_list,
            tauri_commands::notes::delete_note_list,
            tauri_commands::notes::restore_note_list,
            tauri_commands::notes::open_note_list,
            tauri_commands::notes::count_notes,
            tauri_commands::notes::notes_summary,
            tauri_commands::notes::export_notes,
            tauri_commands::search::search,
            tauri_commands::search::search_contents,
            tauri_commands::search::stop_content_search,
            tauri_commands::settings::get_settings,
            tauri_commands::settings::set_settings,
            tauri_commands::shortcut::get_global_shortcut_status,
            tauri_commands::shortcut::set_shortcut_recording,
            tauri_commands::window::set_window_visible,
            tauri_commands::window::show_window,
            tauri_commands::diagnostics::log_frontend_error,
        ])
        .build(::tauri::generate_context!())
        .expect("error while building tauri application")
        .run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_argument_skips_the_binary_and_flags() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            folder_argument(&args(&["sidekyk", "--flag", "proj"])),
            Some(PathBuf::from("proj"))
        );
        assert_eq!(folder_argument(&args(&["sidekyk"])), None);
    }
}
