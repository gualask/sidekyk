//! Tauri adapters for the list of projects.

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::blocking::blocking;
use super::notes::project_book;
use super::state::{self, ProjectsState};
use super::texts;
use crate::infrastructure::notes_files::NotesFiles;
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::projects::{ProjectList, Relocation, TilesLayout};
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// Every project, and the one on screen.
pub(crate) fn get_projects(app: tauri::AppHandle) -> ProjectList {
    app.state::<ProjectsState>().list()
}

#[tauri::command]
/// The project a folder given on the command line put on screen, once, to show its panels.
pub(crate) fn take_opened_project(app: tauri::AppHandle) -> Option<String> {
    app.state::<ProjectsState>().take_opened()
}

#[tauri::command]
/// Asks for a folder, adds the repository that contains it and puts it on screen. `None` when
/// cancelled.
pub(crate) async fn add_project(app: tauri::AppHandle) -> Result<Option<ProjectList>, AppError> {
    blocking("add_project", app, |app| {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title(texts::current(app).add_repository)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        state::open_folder(app, &folder.into_path()?).map(Some)
    })
    .await
}

#[tauri::command]
/// Puts a project on screen.
pub(crate) async fn activate_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectList, AppError> {
    blocking("activate_project", app, move |app| {
        app.state::<ProjectsState>()
            .update(app, |list| list.activate(&project_id))
    })
    .await
}

#[tauri::command]
/// Forgets a project and deletes its notes; its repository is left as it is. The notes go first:
/// if they cannot, the project stays, so nothing is left on disk without it.
pub(crate) async fn remove_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectList, AppError> {
    blocking("remove_project", app, move |app| {
        let projects = app.state::<ProjectsState>();
        let project = projects.project(&project_id)?;
        app.state::<NotesStore>()
            .delete_book(app.state::<NotesFiles>().inner(), &project_book(&project))?;
        projects.update(app, |list| list.remove(&project_id))
    })
    .await
}

#[tauri::command]
/// Keeps how a project lays out its tiles.
pub(crate) async fn set_project_layout(
    app: tauri::AppHandle,
    project_id: String,
    layout: TilesLayout,
) -> Result<ProjectList, AppError> {
    blocking("set_project_layout", app, move |app| {
        app.state::<ProjectsState>()
            .update_stored(app, |list| list.set_layout(&project_id, layout))
    })
    .await
}

#[tauri::command]
/// Asks for the folder a moved repository is in now, and the project follows it there, keeping its
/// id, notes and layout; a folder that is another project's is not taken, and that project comes
/// back. `None` when cancelled.
pub(crate) async fn relocate_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<Relocation>, AppError> {
    blocking("relocate_project", app, move |app| {
        let projects = app.state::<ProjectsState>();
        let project = projects.project(&project_id)?;
        let Some(folder) = app
            .dialog()
            .file()
            .set_title(texts::current(app).locate.replace("{name}", &project.name))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let found = projects.folder_at(&folder.into_path()?)?;
        let (other, list) = projects.update_with(app, |list| list.relocate(&project_id, found))?;
        Ok(Some(match other {
            Some(other) => Relocation::InProject {
                id: other.id,
                name: other.name,
            },
            None => Relocation::Moved { list },
        }))
    })
    .await
}
