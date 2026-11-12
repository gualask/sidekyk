//! The notes' commands, their images' in `note_images.rs`, their lists' in `note_lists.rs`. Every
//! command names a book: the Inbox, or a project of the list.

pub(crate) mod image_scheme;
pub(crate) mod images;
pub(crate) mod lists;

use std::path::PathBuf;

use tauri_plugin_dialog::DialogExt;

use super::blocking::{blocking, notes, ports, with_notes, with_store};
use crate::desktop::texts;
use sidekyk_core::modules::notes::{ListTarget, MovedNote, Note, NotesCount, ProjectNotes};
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// Every note of a book, its lists and the one open.
pub(crate) async fn get_notes(
    app: tauri::AppHandle,
    book: String,
) -> Result<ProjectNotes, AppError> {
    with_notes("get_notes", app, book, |store, files, book| {
        store.notes(files, book)
    })
    .await
}

#[tauri::command]
/// Writes a new note on top of a list.
pub(crate) async fn add_note(
    app: tauri::AppHandle,
    book: String,
    list: String,
    text: String,
) -> Result<Note, AppError> {
    with_notes("add_note", app, book, move |store, files, book| {
        store.add_note(files, book, &list, text)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_note_text(
    app: tauri::AppHandle,
    book: String,
    id: String,
    text: String,
) -> Result<Note, AppError> {
    with_notes("set_note_text", app, book, move |store, files, book| {
        store.set_note_text(files, book, &id, text)
    })
    .await
}

#[tauri::command]
/// What a note's copy puts on the clipboard: its text, then where each image is, a line each, as
/// the project's agents name it (in a WSL distro, its own path).
pub(crate) async fn copy_note(
    app: tauri::AppHandle,
    book: String,
    id: String,
) -> Result<String, AppError> {
    blocking("copy_note", app, move |app| notes(app).copy(&book, &id)).await
}

#[tauri::command]
pub(crate) async fn set_note_done(
    app: tauri::AppHandle,
    book: String,
    id: String,
    done: bool,
) -> Result<Note, AppError> {
    with_notes("set_note_done", app, book, move |store, files, book| {
        store.set_note_done(files, book, &id, done)
    })
    .await
}

#[tauri::command]
/// Moves a note to a place among the open notes of a list; the notes whose place changed.
pub(crate) async fn place_note(
    app: tauri::AppHandle,
    book: String,
    id: String,
    list: String,
    index: u32,
) -> Result<Vec<Note>, AppError> {
    with_notes("place_note", app, book, move |store, files, book| {
        store.place_note(files, book, &id, &list, index as usize)
    })
    .await
}

#[tauri::command]
/// Puts a note back as it was (undo).
pub(crate) async fn restore_note(
    app: tauri::AppHandle,
    book: String,
    note: Note,
) -> Result<Note, AppError> {
    with_notes("restore_note", app, book, move |store, files, book| {
        store.restore_note(files, book, note)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_note(
    app: tauri::AppHandle,
    book: String,
    id: String,
) -> Result<(), AppError> {
    with_notes("delete_note", app, book, move |store, files, book| {
        store.delete_note(files, book, &id)
    })
    .await
}

#[tauri::command]
/// Moves a note to another book, or another list of its own, keeping its id.
pub(crate) async fn move_note(
    app: tauri::AppHandle,
    from: String,
    id: String,
    to: String,
    list: ListTarget,
) -> Result<MovedNote, AppError> {
    with_store("move_note", app, move |app, store, files| {
        let (from, to) = (notes(app).book(&from)?, notes(app).book(&to)?);
        store.move_note(files, &from, &id, &to, list)
    })
    .await
}

#[tauri::command]
/// Puts a moved note back in its book as it was, and takes it out of the one it went to (undo).
pub(crate) async fn unmove_note(
    app: tauri::AppHandle,
    at: String,
    original: Note,
    home: String,
) -> Result<Note, AppError> {
    with_store("unmove_note", app, move |app, store, files| {
        let (at, home) = (notes(app).book(&at)?, notes(app).book(&home)?);
        store.unmove_note(files, &at, original, &home)
    })
    .await
}

#[tauri::command]
/// How many notes a book has, open and done: the open ones on a project's row, all of them what
/// removing it would delete.
pub(crate) async fn count_notes(
    app: tauri::AppHandle,
    book: String,
) -> Result<NotesCount, AppError> {
    with_notes("count_notes", app, book, |store, files, book| {
        store.count(files, book)
    })
    .await
}

#[tauri::command]
/// Asks where to save a project's notes as Markdown and writes them there; the path written, or
/// `None` when cancelled. With images, a folder: the Markdown file named after it, the images in
/// `images/` inside it. Never inside a project's folder: Sidekyk writes in none.
pub(crate) async fn export_notes(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<String>, AppError> {
    blocking("export_notes", app, move |app| {
        let notes = notes(app);
        let target = notes.export_target(&project_id)?;
        let texts = texts::current();
        let file_name = texts.export_file.replace("{name}", &target.name);
        let dialog = app.dialog().file().set_title(texts.export_notes);
        let dialog = if target.folder {
            dialog.set_file_name(file_name.trim_end_matches(".md"))
        } else {
            dialog
                .set_file_name(&file_name)
                .add_filter("Markdown", &["md"])
        };
        let Some(path) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path: PathBuf = path.into_path()?;
        notes.export(&project_id, &path, &texts.export, &*ports(app).export)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}
