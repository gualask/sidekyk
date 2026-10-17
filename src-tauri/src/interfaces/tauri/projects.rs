//! Tauri adapters for the list of projects.

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::blocking::blocking;
use super::state::{self, ProjectsState};
use crate::modules::projects::{ProjectList, TilesLayout};
use crate::shared::error::AppError;

#[tauri::command]
/// Every project, and the one on screen.
pub(crate) fn get_projects(app: tauri::AppHandle) -> ProjectList {
    app.state::<ProjectsState>().list()
}

#[tauri::command]
/// Asks for a folder, adds the repository that contains it and puts it on screen. `None` when
/// cancelled.
pub(crate) async fn add_project(app: tauri::AppHandle) -> Result<Option<ProjectList>, AppError> {
    blocking("add_project", app, |app| {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("Add a repository")
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
    root: String,
) -> Result<ProjectList, AppError> {
    blocking("activate_project", app, move |app| {
        app.state::<ProjectsState>()
            .update(app, |list| list.activate(&root))
    })
    .await
}

#[tauri::command]
/// Forgets a project; its repository is left as it is.
pub(crate) async fn remove_project(
    app: tauri::AppHandle,
    root: String,
) -> Result<ProjectList, AppError> {
    blocking("remove_project", app, move |app| {
        app.state::<ProjectsState>()
            .update(app, |list| list.remove(&root))
    })
    .await
}

#[tauri::command]
/// Keeps how a project lays out its tiles.
pub(crate) async fn set_project_layout(
    app: tauri::AppHandle,
    root: String,
    layout: TilesLayout,
) -> Result<ProjectList, AppError> {
    blocking("set_project_layout", app, move |app| {
        app.state::<ProjectsState>()
            .update_stored(app, |list| list.set_layout(&root, layout))
    })
    .await
}
