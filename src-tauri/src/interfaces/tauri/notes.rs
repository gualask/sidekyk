//! Tauri adapters for a project's notes. Every command names a project of the list.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use crate::infrastructure::notes_files::NotesFiles;
use crate::modules::notes::{DeletedList, Note, NoteList, NotesStore, ProjectNotes};
use crate::shared::error::AppError;

/// Runs `work` on a project's notes, once the project is known to be in the list.
async fn with_notes<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    root: String,
    work: impl FnOnce(&NotesStore, &NotesFiles, &str) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        app.state::<ProjectsState>().project(&root)?;
        work(
            &app.state::<NotesStore>(),
            &app.state::<NotesFiles>(),
            &root,
        )
    })
    .await
}

#[tauri::command]
/// Every note of a project, its lists and the one open.
pub(crate) async fn get_notes(
    app: tauri::AppHandle,
    root: String,
) -> Result<ProjectNotes, AppError> {
    with_notes("get_notes", app, root, |store, files, root| {
        store.notes(files, root)
    })
    .await
}

#[tauri::command]
/// Writes a new note on top of a list.
pub(crate) async fn add_note(
    app: tauri::AppHandle,
    root: String,
    list: String,
    text: String,
) -> Result<Note, AppError> {
    with_notes("add_note", app, root, move |store, files, root| {
        store.add_note(files, root, &list, text)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_note_text(
    app: tauri::AppHandle,
    root: String,
    id: String,
    text: String,
) -> Result<Note, AppError> {
    with_notes("set_note_text", app, root, move |store, files, root| {
        store.set_note_text(files, root, &id, text)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_note_done(
    app: tauri::AppHandle,
    root: String,
    id: String,
    done: bool,
) -> Result<Note, AppError> {
    with_notes("set_note_done", app, root, move |store, files, root| {
        store.set_note_done(files, root, &id, done)
    })
    .await
}

#[tauri::command]
/// Moves a note to a place among the open notes of a list; the notes whose place changed.
pub(crate) async fn place_note(
    app: tauri::AppHandle,
    root: String,
    id: String,
    list: String,
    index: u32,
) -> Result<Vec<Note>, AppError> {
    with_notes("place_note", app, root, move |store, files, root| {
        store.place_note(files, root, &id, &list, index as usize)
    })
    .await
}

#[tauri::command]
/// Puts a note back as it was (undo).
pub(crate) async fn restore_note(
    app: tauri::AppHandle,
    root: String,
    note: Note,
) -> Result<Note, AppError> {
    with_notes("restore_note", app, root, move |store, files, root| {
        store.restore_note(files, root, note)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_note(
    app: tauri::AppHandle,
    root: String,
    id: String,
) -> Result<(), AppError> {
    with_notes("delete_note", app, root, move |store, files, root| {
        store.delete_note(files, root, &id)
    })
    .await
}

#[tauri::command]
/// A new list, last, and open.
pub(crate) async fn add_note_list(
    app: tauri::AppHandle,
    root: String,
    name: String,
) -> Result<NoteList, AppError> {
    with_notes("add_note_list", app, root, move |store, files, root| {
        store.add_list(files, root, &name)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rename_note_list(
    app: tauri::AppHandle,
    root: String,
    id: String,
    name: String,
) -> Result<NoteList, AppError> {
    with_notes("rename_note_list", app, root, move |store, files, root| {
        store.rename_list(files, root, &id, &name)
    })
    .await
}

#[tauri::command]
/// Deletes a list and its notes; what comes back brings them back.
pub(crate) async fn delete_note_list(
    app: tauri::AppHandle,
    root: String,
    id: String,
) -> Result<DeletedList, AppError> {
    with_notes("delete_note_list", app, root, move |store, files, root| {
        store.delete_list(files, root, &id)
    })
    .await
}

#[tauri::command]
/// Brings back a deleted list with its notes (undo).
pub(crate) async fn restore_note_list(
    app: tauri::AppHandle,
    root: String,
    deleted: DeletedList,
) -> Result<ProjectNotes, AppError> {
    with_notes("restore_note_list", app, root, move |store, files, root| {
        store.restore_list(files, root, deleted)
    })
    .await
}

#[tauri::command]
/// Remembers the list open, for the next time the project shows.
pub(crate) async fn open_note_list(
    app: tauri::AppHandle,
    root: String,
    id: String,
) -> Result<(), AppError> {
    with_notes("open_note_list", app, root, move |store, files, root| {
        store.open_list(files, root, &id)
    })
    .await
}
