//! The composition root, the only place that names both adapters and entry points: the plugins,
//! the managed state, the core's ports given their adapters, the commands, and what the tray, the
//! global shortcuts and the app's events call.

use std::path::PathBuf;
use std::sync::Arc;

use ::tauri::path::BaseDirectory;
use ::tauri::{Emitter, Manager};

use crate::desktop::capture::CaptureSession;
use crate::desktop::launch::Launch;
use crate::desktop::quick_note::QuickNoteState;
use crate::desktop::settings::{apply_language, AppliedSettings};
use crate::desktop::window::{self, FirstShow};
use crate::infrastructure::files::HostFiles;
use crate::infrastructure::notes_files::NotesFiles;
use crate::infrastructure::settings_store::{self, SettingsFile};
use crate::infrastructure::tray::TrayActions;
use crate::infrastructure::{global_shortcuts, logging, tray};
use crate::interfaces::tauri as tauri_commands;
use crate::interfaces::tauri::blocking::Ports;
use crate::interfaces::tauri::cli::{self, TOGGLE_FLAG};
use crate::interfaces::tauri::{lifecycle, shortcuts};
use sidekyk_core::app::machines::Machines;
use sidekyk_core::app::projects::Projects;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::machines::local::LocalMachine;
use sidekyk_core::infrastructure::machines::wsl::WslRepositories;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::folder::{RepositoryChangedEvent, REPOSITORY_CHANGED_EVENT};
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::reader::{LocalRepositories, Repositories};

/// This machine's folders, read here. A dev build started with `SIDEKYK_AGENT=local` reads them
/// through the helper instead, a child process beside the app's binary, as it reads a WSL
/// distro's (`docs/features/wsl.md`).
fn local_reader() -> Arc<dyn Repositories> {
    #[cfg(debug_assertions)]
    if std::env::var_os("SIDEKYK_AGENT").is_some_and(|agent| agent == "local") {
        use sidekyk_core::infrastructure::agent::{helper_beside_this_binary, AgentRepositories};
        return Arc::new(AgentRepositories::new(|| Ok(helper_beside_this_binary())));
    }
    LocalRepositories::new(
        Arc::new(LocalRepositoryBackend::default()),
        Arc::new(LocalRepositoryWatcher::default()),
    )
}

/// The project list, stored in `settings`, its folders read on this machine and in WSL distros
/// (`helper`, the Linux helper the installer ships); a change of the folder on screen goes to the
/// page.
fn projects(app: &::tauri::AppHandle, settings: Arc<SettingsFile>, helper: PathBuf) -> Projects {
    let machines = Machines::new(
        Arc::new(LocalMachine::new(local_reader())),
        vec![Arc::new(WslRepositories::new(helper))],
    );
    let page = app.clone();
    Projects::new(
        machines,
        settings,
        Arc::new(move |folder_id, change| {
            let event = RepositoryChangedEvent::new(folder_id, change);
            let _ = page.emit(REPOSITORY_CHANGED_EVENT, event);
        }),
    )
}

/// Boots the Tauri app and registers all commands/plugins.
pub(crate) fn run() {
    let builder = ::tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        cli::launched_again(app, &args, &cwd);
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol(
            tauri_commands::project_file::SCHEME,
            |context, request, responder| {
                tauri_commands::project_file::respond(
                    context.app_handle(),
                    request.uri().path(),
                    request.uri().query(),
                    responder,
                )
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            tauri_commands::note_image::SCHEME,
            |context, request, responder| {
                tauri_commands::note_image::respond(
                    context.app_handle(),
                    request.uri().path(),
                    responder,
                )
            },
        )
        .manage(NotesStore::default())
        .manage(Launch::default())
        .manage(FirstShow::default())
        .manage(CaptureSession::default())
        .manage(QuickNoteState::default())
        .setup(|app| {
            if let Ok(dir) = app.path().app_log_dir() {
                logging::init(&dir);
            }
            let data = app.path().app_data_dir()?;
            let settings_file = Arc::new(SettingsFile::open(&data));
            app.manage(settings_file.clone());
            app.manage(Ports {
                notes: Box::new(NotesFiles::new(&data)),
                given: Box::new(HostFiles),
                export: Box::new(HostFiles),
            });
            // the Linux helper WSL distros run, among the installer's resources on Windows
            // (`tauri.helper.conf.json`, the installer build only)
            let helper = app
                .path()
                .resolve("linux/sidekyk-agent", BaseDirectory::Resource)
                .unwrap_or_else(|error| {
                    tracing::warn!(%error, "no resources: WSL projects cannot be read");
                    PathBuf::new()
                });
            app.manage(projects(app.handle(), settings_file, helper));
            let settings = settings_store::load_settings(app.handle());
            // before the windows, whose pages may change the settings as they load; applied below
            app.manage(AppliedSettings::new(settings.clone()));
            // before the windows: their pages reach the shortcut's state as they load
            global_shortcuts::start(app.handle(), &settings, shortcuts::pressed, TOGGLE_FLAG);
            window::create(app.handle(), settings.theme)?;
            // before the tray, which starts in the language returned
            let texts = apply_language(app.handle(), settings.language);
            let actions = TrayActions {
                show: tauri_commands::tray::show,
                capture: tauri_commands::tray::capture,
                note: tauri_commands::tray::note,
                quit: tauri_commands::tray::quit,
                click: tauri_commands::tray::show,
            };
            tray::start(app.handle(), texts.tray(), actions);
            cli::launched(app.handle());
            Ok(())
        })
        .on_page_load(lifecycle::page_loading)
        .on_window_event(lifecycle::window_event)
        .invoke_handler(::tauri::generate_handler![
            tauri_commands::projects::get_projects,
            tauri_commands::projects::take_opened,
            tauri_commands::projects::choose_project_folder,
            tauri_commands::projects::create_project,
            tauri_commands::projects::rename_project,
            tauri_commands::projects::activate_project,
            tauri_commands::projects::remove_project,
            tauri_commands::projects::set_project_layout,
            tauri_commands::projects::relocate_folder,
            tauri_commands::projects::show_project_folder,
            tauri_commands::projects::add_project_folder,
            tauri_commands::projects::remove_project_folder,
            tauri_commands::projects::merge_projects,
            tauri_commands::repository::get_folder_kind,
            tauri_commands::repository::get_repository_snapshot,
            tauri_commands::repository::get_repository_summary,
            tauri_commands::repository::get_file_diff,
            tauri_commands::repository::get_changes_ignoring_whitespace,
            tauri_commands::repository::get_recent_commits,
            tauri_commands::repository::get_commit_activity,
            tauri_commands::repository::get_commit_files,
            tauri_commands::repository::get_commit_file_diff,
            tauri_commands::repository::get_directory,
            tauri_commands::repository::get_recent_files,
            tauri_commands::repository::get_file_content,
            tauri_commands::repository::get_markdown_preview,
            tauri_commands::repository::folders_holding,
            tauri_commands::repository::get_file_stamp,
            tauri_commands::repository::get_blob_size,
            tauri_commands::links::open_url,
            tauri_commands::diagram::render_diagram,
            tauri_commands::repository::get_syntax_colors,
            tauri_commands::notes::get_notes,
            tauri_commands::notes::add_note,
            tauri_commands::notes::set_note_text,
            tauri_commands::notes::set_note_done,
            tauri_commands::notes::add_note_image_files,
            tauri_commands::notes::add_note_image,
            tauri_commands::notes::mark_note_image,
            tauri_commands::notes::remove_note_image,
            tauri_commands::notes::copy_note,
            tauri_commands::quick_note::quick_note_shown,
            tauri_commands::quick_note::close_quick_note,
            tauri_commands::quick_note::quick_note_restored,
            tauri_commands::capture::can_capture,
            tauri_commands::capture::start_capture,
            tauri_commands::capture::add_capture,
            tauri_commands::capture::set_marking,
            tauri_commands::capture::open_capture_settings,
            tauri_commands::notes::note_image_png,
            tauri_commands::notes::place_note,
            tauri_commands::notes::restore_note,
            tauri_commands::notes::delete_note,
            tauri_commands::notes::move_note,
            tauri_commands::notes::unmove_note,
            tauri_commands::notes::move_list,
            tauri_commands::notes::unmove_list,
            tauri_commands::notes::add_note_list,
            tauri_commands::notes::rename_note_list,
            tauri_commands::notes::delete_note_list,
            tauri_commands::notes::restore_note_list,
            tauri_commands::notes::open_note_list,
            tauri_commands::notes::count_notes,
            tauri_commands::notes::export_notes,
            tauri_commands::search::search,
            tauri_commands::search::search_contents,
            tauri_commands::search::stop_content_search,
            tauri_commands::search::rank_names,
            tauri_commands::search::search_files,
            tauri_commands::settings::get_settings,
            tauri_commands::settings::set_settings,
            tauri_commands::shortcuts::get_global_shortcut_status,
            tauri_commands::shortcuts::set_shortcut_recording,
            tauri_commands::window::set_window_visible,
            tauri_commands::window::show_window,
            tauri_commands::diagnostics::log_frontend_error,
            tauri_commands::diagnostics::get_version,
            tauri_commands::diagnostics::reveal_log,
        ])
        .build(::tauri::generate_context!())
        .expect("error while building tauri application")
        .run(lifecycle::run_event);
}
