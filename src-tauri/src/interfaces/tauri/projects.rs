//! Tauri adapters for the list of projects.

use std::path::Path;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::blocking::blocking;
use super::notes::project_book;
use super::state::ProjectsState;
use super::texts;
use crate::infrastructure::notes_files::NotesFiles;
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::projects::{FolderChoice, ProjectList, Relocation, TilesLayout};
use sidekyk_core::shared::error::{user_facing_code, AppError, UserFacingErrorCode};

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
/// Asks for a new project's folder and says what it is: a repository no project follows yet, with
/// its name; another project's; or not a repository. `None` when cancelled.
pub(crate) async fn choose_project_folder(
    app: tauri::AppHandle,
) -> Result<Option<FolderChoice>, AppError> {
    blocking("choose_project_folder", app, |app| {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title(texts::current(app).choose_folder)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = folder.into_path()?;
        let projects = app.state::<ProjectsState>();
        let found = match projects.folder_at(&path) {
            Ok(found) => found,
            Err(error) if user_facing_code(&error) == Some(UserFacingErrorCode::NotARepository) => {
                return Ok(Some(FolderChoice::NotRepository));
            }
            Err(error) => return Err(error),
        };
        // given back to `create_project` as a string, as every path the frontend holds
        let path = path
            .into_os_string()
            .into_string()
            .map_err(|_| anyhow::anyhow!("the folder's path is not Unicode"))?;
        Ok(Some(projects.list().folder_choice(path, found)))
    })
    .await
}

#[tauri::command]
/// Adds a project of this name, following the repository at `folder` (a path as
/// `choose_project_folder` gave it, checked again) or none, and puts it on screen.
pub(crate) async fn create_project(
    app: tauri::AppHandle,
    name: String,
    folder: Option<String>,
) -> Result<ProjectList, AppError> {
    blocking("create_project", app, move |app| {
        let projects = app.state::<ProjectsState>();
        let folder = match folder {
            Some(path) => Some(projects.folder_at(Path::new(&path))?.location),
            None => None,
        };
        projects.update(app, |list| {
            let project = list.add(&name, folder)?;
            list.activate(&project.id)
        })
    })
    .await
}

#[tauri::command]
/// Names a project anew.
pub(crate) async fn rename_project(
    app: tauri::AppHandle,
    project_id: String,
    name: String,
) -> Result<ProjectList, AppError> {
    blocking("rename_project", app, move |app| {
        app.state::<ProjectsState>()
            .update_stored(app, |list| list.rename(&project_id, &name))
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
