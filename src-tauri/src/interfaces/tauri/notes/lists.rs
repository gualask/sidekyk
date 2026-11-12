//! The commands on a book's lists: added, renamed, deleted and brought back, the one open, moved
//! to another project and back. Every command names a book: the Inbox, or a project of the list.

use super::super::blocking::{notes, with_notes, with_store};
use sidekyk_core::modules::notes::{DeletedList, MovedList, NoteList, ProjectNotes};
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// Moves a list with its notes to another project; what comes back undoes it.
pub(crate) async fn move_list(
    app: tauri::AppHandle,
    from: String,
    list: String,
    to: String,
) -> Result<MovedList, AppError> {
    with_store("move_list", app, move |app, store, files| {
        let (from, to) = (notes(app).book(&from)?, notes(app).book(&to)?);
        store.move_list(files, &from, &list, &to)
    })
    .await
}

#[tauri::command]
/// Brings a moved list back where it was, with its notes (undo).
pub(crate) async fn unmove_list(app: tauri::AppHandle, moved: MovedList) -> Result<(), AppError> {
    with_store("unmove_list", app, move |app, store, files| {
        let (from, to) = (notes(app).book(&moved.from)?, notes(app).book(&moved.to)?);
        store.unmove_list(files, &from, &to, moved)
    })
    .await
}

#[tauri::command]
/// A new list, last, and open.
pub(crate) async fn add_note_list(
    app: tauri::AppHandle,
    book: String,
    name: String,
) -> Result<NoteList, AppError> {
    with_notes("add_note_list", app, book, move |store, files, book| {
        store.add_list(files, book, &name)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rename_note_list(
    app: tauri::AppHandle,
    book: String,
    id: String,
    name: String,
) -> Result<NoteList, AppError> {
    with_notes("rename_note_list", app, book, move |store, files, book| {
        store.rename_list(files, book, &id, &name)
    })
    .await
}

#[tauri::command]
/// Deletes a list and its notes; what comes back brings them back.
pub(crate) async fn delete_note_list(
    app: tauri::AppHandle,
    book: String,
    id: String,
) -> Result<DeletedList, AppError> {
    with_notes("delete_note_list", app, book, move |store, files, book| {
        store.delete_list(files, book, &id)
    })
    .await
}

#[tauri::command]
/// Brings back a deleted list with its notes (undo).
pub(crate) async fn restore_note_list(
    app: tauri::AppHandle,
    book: String,
    deleted: DeletedList,
) -> Result<ProjectNotes, AppError> {
    with_notes("restore_note_list", app, book, move |store, files, book| {
        store.restore_list(files, book, deleted)
    })
    .await
}

#[tauri::command]
/// Remembers the list open, for the next time the project shows.
pub(crate) async fn open_note_list(
    app: tauri::AppHandle,
    book: String,
    id: String,
) -> Result<(), AppError> {
    with_notes("open_note_list", app, book, move |store, files, book| {
        store.open_list(files, book, &id)
    })
    .await
}
