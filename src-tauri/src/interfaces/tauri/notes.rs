//! Tauri adapters for a project's notes. Every command names a project of the list.

use std::path::PathBuf;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::blocking::blocking;
use super::state::ProjectsState;
use crate::infrastructure::notes_files::{resolved_path, write_chosen_file, NotesFiles};
use sidekyk_core::infrastructure::wsl::wsl_path;
use sidekyk_core::modules::notes::{
    to_markdown, DeletedList, Note, NoteList, NotesStore, NotesSummary, ProjectNotes,
};
use sidekyk_core::shared::error::{user_facing, AppError, UserFacingErrorCode};

/// Runs `work` on a project's notes, once the project is known to be in the list.
async fn with_notes<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    project_id: String,
    work: impl FnOnce(&NotesStore, &NotesFiles, &str) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        app.state::<ProjectsState>().project(&project_id)?;
        work(
            &app.state::<NotesStore>(),
            &app.state::<NotesFiles>(),
            &project_id,
        )
    })
    .await
}

#[tauri::command]
/// Every note of a project, its lists and the one open.
pub(crate) async fn get_notes(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectNotes, AppError> {
    with_notes("get_notes", app, project_id, |store, files, project_id| {
        store.notes(files, project_id)
    })
    .await
}

#[tauri::command]
/// Writes a new note on top of a list.
pub(crate) async fn add_note(
    app: tauri::AppHandle,
    project_id: String,
    list: String,
    text: String,
) -> Result<Note, AppError> {
    with_notes(
        "add_note",
        app,
        project_id,
        move |store, files, project_id| store.add_note(files, project_id, &list, text),
    )
    .await
}

#[tauri::command]
pub(crate) async fn set_note_text(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
    text: String,
) -> Result<Note, AppError> {
    with_notes(
        "set_note_text",
        app,
        project_id,
        move |store, files, project_id| store.set_note_text(files, project_id, &id, text),
    )
    .await
}

#[tauri::command]
pub(crate) async fn set_note_done(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
    done: bool,
) -> Result<Note, AppError> {
    with_notes(
        "set_note_done",
        app,
        project_id,
        move |store, files, project_id| store.set_note_done(files, project_id, &id, done),
    )
    .await
}

#[tauri::command]
/// Moves a note to a place among the open notes of a list; the notes whose place changed.
pub(crate) async fn place_note(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
    list: String,
    index: u32,
) -> Result<Vec<Note>, AppError> {
    with_notes(
        "place_note",
        app,
        project_id,
        move |store, files, project_id| {
            store.place_note(files, project_id, &id, &list, index as usize)
        },
    )
    .await
}

#[tauri::command]
/// Puts a note back as it was (undo).
pub(crate) async fn restore_note(
    app: tauri::AppHandle,
    project_id: String,
    note: Note,
) -> Result<Note, AppError> {
    with_notes(
        "restore_note",
        app,
        project_id,
        move |store, files, project_id| store.restore_note(files, project_id, note),
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_note(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
) -> Result<(), AppError> {
    with_notes(
        "delete_note",
        app,
        project_id,
        move |store, files, project_id| store.delete_note(files, project_id, &id),
    )
    .await
}

#[tauri::command]
/// A new list, last, and open.
pub(crate) async fn add_note_list(
    app: tauri::AppHandle,
    project_id: String,
    name: String,
) -> Result<NoteList, AppError> {
    with_notes(
        "add_note_list",
        app,
        project_id,
        move |store, files, project_id| store.add_list(files, project_id, &name),
    )
    .await
}

#[tauri::command]
pub(crate) async fn rename_note_list(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
    name: String,
) -> Result<NoteList, AppError> {
    with_notes(
        "rename_note_list",
        app,
        project_id,
        move |store, files, project_id| store.rename_list(files, project_id, &id, &name),
    )
    .await
}

#[tauri::command]
/// Deletes a list and its notes; what comes back brings them back.
pub(crate) async fn delete_note_list(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
) -> Result<DeletedList, AppError> {
    with_notes(
        "delete_note_list",
        app,
        project_id,
        move |store, files, project_id| store.delete_list(files, project_id, &id),
    )
    .await
}

#[tauri::command]
/// Brings back a deleted list with its notes (undo).
pub(crate) async fn restore_note_list(
    app: tauri::AppHandle,
    project_id: String,
    deleted: DeletedList,
) -> Result<ProjectNotes, AppError> {
    with_notes(
        "restore_note_list",
        app,
        project_id,
        move |store, files, project_id| store.restore_list(files, project_id, deleted),
    )
    .await
}

#[tauri::command]
/// Remembers the list open, for the next time the project shows.
pub(crate) async fn open_note_list(
    app: tauri::AppHandle,
    project_id: String,
    id: String,
) -> Result<(), AppError> {
    with_notes(
        "open_note_list",
        app,
        project_id,
        move |store, files, project_id| store.open_list(files, project_id, &id),
    )
    .await
}

#[tauri::command]
/// What a project's card at all projects tells of its notes.
pub(crate) async fn notes_summary(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<NotesSummary, AppError> {
    with_notes(
        "notes_summary",
        app,
        project_id,
        |store, files, project_id| store.summary(files, project_id),
    )
    .await
}

#[tauri::command]
/// How many notes a project has, open and done: what removing it would delete.
pub(crate) async fn count_notes(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<u32, AppError> {
    with_notes(
        "count_notes",
        app,
        project_id,
        |store, files, project_id| Ok(store.count(files, project_id)? as u32),
    )
    .await
}

#[tauri::command]
/// Asks where to save a project's notes as Markdown and writes them there; the path written, or
/// `None` when cancelled. Never inside a project's repository: Sidekyk writes in none.
pub(crate) async fn export_notes(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<String>, AppError> {
    blocking("export_notes", app, move |app| {
        let projects = app.state::<ProjectsState>();
        let project = projects.project(&project_id)?;
        let Some(path) = app
            .dialog()
            .file()
            .set_title("Export notes")
            .set_file_name(format!("{}-notes.md", project.name))
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path: PathBuf = path.into_path()?;
        let ignore_case = cfg!(any(target_os = "macos", windows));
        let list = projects.list();
        let inside = match wsl_path(&path) {
            Some((distro, path)) => list.holds_in_wsl(&distro, &path),
            None => list.holds(&path, resolved_path, ignore_case),
        };
        if inside {
            return Err(user_facing(UserFacingErrorCode::ExportInRepository));
        }
        let markdown = app.state::<NotesStore>().read_notes(
            app.state::<NotesFiles>().inner(),
            &project_id,
            |lists, notes| to_markdown(&project.name, lists, notes),
        )?;
        write_chosen_file(&path, markdown.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}
