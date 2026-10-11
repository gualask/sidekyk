//! Tauri composition root.
//!
//! Runtime plugins, managed state, and the stable inbound command list are wired here. Modules
//! and infrastructure services remain unaware of this composition root.

use std::path::{Path, PathBuf};

use ::tauri::Manager;

use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::infrastructure::{logging, settings_store};
use crate::interfaces::tauri as tauri_commands;
use crate::interfaces::tauri::state::{activate_repository, RepositoryState};

/// The first argument that is not a flag: `sidekyk ~/Dev/project` opens that repository.
fn folder_argument(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(PathBuf::from)
}

fn show_main_window(app: &::tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Opens a repository named at launch; a failure leaves the app as it was.
fn open_or_log(app: &::tauri::AppHandle, folder: &Path) {
    if let Err(error) = activate_repository(app, folder) {
        tracing::warn!(
            folder = %folder.display(),
            error = %format!("{error:#}"),
            "could not open the repository"
        );
    }
}

/// Boots the Tauri app and registers all commands/plugins.
pub(crate) fn run() {
    let builder = ::tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        if let Some(folder) = folder_argument(&args) {
            open_or_log(app, &PathBuf::from(cwd).join(folder));
        }
        show_main_window(app);
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(LocalRepositoryBackend::default())
        .manage(RepositoryState::default())
        .setup(|app| {
            if let Ok(dir) = app.path().app_log_dir() {
                logging::init(&dir);
            }
            let args: Vec<String> = std::env::args().collect();
            let candidate = folder_argument(&args)
                .or_else(|| settings_store::load_last_repository(app.handle()));
            if let Some(folder) = candidate {
                // a moved or deleted repository just leaves the app on its empty state
                open_or_log(app.handle(), &folder);
            }
            Ok(())
        })
        .invoke_handler(::tauri::generate_handler![
            tauri_commands::repository::get_active_repository,
            tauri_commands::repository::pick_repository,
            tauri_commands::repository::get_repository_snapshot,
            tauri_commands::repository::get_file_diff,
            tauri_commands::diagnostics::log_frontend_error,
        ])
        .run(::tauri::generate_context!())
        .expect("error while running tauri application");
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
