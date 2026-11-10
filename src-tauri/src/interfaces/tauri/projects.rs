//! Tauri adapters for the list of projects.

use std::path::Path;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::blocking::blocking;
use super::notes::notes;
use super::state::Launch;
use super::texts;
use crate::infrastructure::notes_files::NotesFiles;
use sidekyk_core::app::projects::Projects;
use sidekyk_core::modules::folder::repository_name;
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::projects::{
    FolderChange, FolderChoice, Opened, Project, ProjectList, TilesLayout,
};
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// Every project, and the one on screen.
pub(crate) fn get_projects(app: tauri::AppHandle) -> ProjectList {
    app.state::<Projects>().list()
}

#[tauri::command]
/// What a folder given on the command line did, once: a project to show its panels, or a folder
/// above repositories to ask about.
pub(crate) fn take_opened(app: tauri::AppHandle) -> Option<Opened> {
    app.state::<Launch>().take_opened()
}

#[tauri::command]
/// Asks for a new project's folder and says what it is: one no project has yet (inside a
/// repository, the repository's root), with its name and, for a folder without git, the
/// repositories right inside it; or another project's. `None` when cancelled.
pub(crate) async fn choose_project_folder(
    app: tauri::AppHandle,
) -> Result<Option<FolderChoice>, AppError> {
    blocking("choose_project_folder", app, |app| {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title(texts::current().choose_folder)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        Ok(Some(
            app.state::<Projects>()
                .folder_choice(&folder.into_path()?)?,
        ))
    })
    .await
}

#[tauri::command]
/// Adds a project of this name, following the folders at `folders` (paths as
/// `choose_project_folder` gave them, checked again; none, one or several), and puts it on screen.
pub(crate) async fn create_project(
    app: tauri::AppHandle,
    name: String,
    folders: Vec<String>,
) -> Result<ProjectList, AppError> {
    blocking("create_project", app, move |app| {
        let projects = app.state::<Projects>();
        let folders = folders
            .iter()
            .map(|path| Ok(projects.folder_at(Path::new(path))?.location))
            .collect::<anyhow::Result<Vec<_>>>()?;
        projects
            .update(|list, case| {
                let project = list.add(&name, folders, case)?;
                list.activate(&project.id)
            })
            .map(|((), list)| list)
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
        app.state::<Projects>()
            .update_stored(|list| list.rename(&project_id, &name))
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
        app.state::<Projects>()
            .update(|list, _| list.activate(&project_id))
            .map(|((), list)| list)
    })
    .await
}

#[tauri::command]
/// Forgets a project and deletes its notes; its folder is left as it is. The notes go first:
/// if they cannot, the project stays, so nothing is left on disk without it.
pub(crate) async fn remove_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectList, AppError> {
    blocking("remove_project", app, move |app| {
        let (store, files) = (app.state::<NotesStore>(), app.state::<NotesFiles>());
        notes(app, &store, &files).remove_project(&project_id)
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
        app.state::<Projects>()
            .update_stored(|list| list.set_layout(&project_id, layout))
    })
    .await
}

#[tauri::command]
/// The folder the window shows, `None` for none: it is watched while on screen, and the palette
/// looks in its files.
pub(crate) async fn show_project_folder(
    app: tauri::AppHandle,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    blocking("show_project_folder", app, move |app| {
        app.state::<Projects>().show_folder(folder_id);
        Ok(())
    })
    .await
}

/// What a folder picked did: the list after it, or the project that has that folder already.
fn folder_change(other: Option<Project>, list: ProjectList) -> FolderChange {
    match other {
        Some(other) => FolderChange::InProject {
            id: other.id,
            name: other.name,
        },
        None => FolderChange::Changed { list },
    }
}

#[tauri::command]
/// Asks for another folder of a project, which it follows after its own; a folder that
/// is another project's is not taken, and that project comes back, to merge it. `None` when
/// cancelled.
pub(crate) async fn add_project_folder(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<FolderChange>, AppError> {
    blocking("add_project_folder", app, move |app| {
        let projects = app.state::<Projects>();
        let project = projects.project(&project_id)?;
        let Some(folder) = app
            .dialog()
            .file()
            .set_title(texts::current().add_folder.replace("{name}", &project.name))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let found = projects.folder_at(&folder.into_path()?)?;
        let (other, list) =
            projects.update(|list, case| list.add_folder(&project_id, found, case))?;
        Ok(Some(folder_change(other, list)))
    })
    .await
}

#[tauri::command]
/// Stops following one of a project's folders; the folder is left as it is, the project keeps its
/// notes.
pub(crate) async fn remove_project_folder(
    app: tauri::AppHandle,
    project_id: String,
    folder_id: String,
) -> Result<ProjectList, AppError> {
    blocking("remove_project_folder", app, move |app| {
        app.state::<Projects>()
            .update(|list, _| list.remove_folder(&project_id, &folder_id))
            .map(|((), list)| list)
    })
    .await
}

#[tauri::command]
/// Merges the project `from` into `into`: its folders follow `into`'s, its lists of notes move
/// into it (one whose name is taken named after `from`), and `from` goes. The notes go first:
/// if they cannot, nothing else changes.
pub(crate) async fn merge_projects(
    app: tauri::AppHandle,
    into: String,
    from: String,
) -> Result<ProjectList, AppError> {
    blocking("merge_projects", app, move |app| {
        let (store, files) = (app.state::<NotesStore>(), app.state::<NotesFiles>());
        notes(app, &store, &files).merge_projects(&into, &from)
    })
    .await
}

#[tauri::command]
/// Asks for the folder a moved folder of a project is in now, and the project follows it there,
/// the folder keeping its id; a folder that is another project's is not taken, and that project
/// comes back. `None` when cancelled.
pub(crate) async fn relocate_folder(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<Option<FolderChange>, AppError> {
    blocking("relocate_folder", app, move |app| {
        let projects = app.state::<Projects>();
        let (_, folder) = projects.folder(&folder_id)?;
        let Some(picked) = app
            .dialog()
            .file()
            .set_title(
                texts::current()
                    .locate
                    .replace("{name}", &repository_name(folder.location.root())),
            )
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let found = projects.folder_at(&picked.into_path()?)?;
        let (other, list) = projects.update(|list, case| list.relocate(&folder_id, found, case))?;
        Ok(Some(folder_change(other, list)))
    })
    .await
}
