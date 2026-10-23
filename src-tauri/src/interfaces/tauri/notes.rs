//! Tauri adapters for notes. Every command names a book: the Inbox, or a project of the list.

use std::path::PathBuf;

use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use super::blocking::blocking;
use super::state::ProjectsState;
use super::texts;
use crate::infrastructure::notes_files::{resolved_path, write_chosen_file, NotesFiles};
use sidekyk_core::infrastructure::wsl::wsl_path;
use sidekyk_core::modules::notes::{
    to_markdown, Book, BookTarget, DeletedList, ListTarget, MovedList, MovedNote, Note, NoteList,
    NotesStore, NotesSummary, ProjectNotes, INBOX_BOOK,
};
use sidekyk_core::modules::projects::{Project, ProjectsChangedEvent, PROJECTS_CHANGED_EVENT};
use sidekyk_core::shared::error::{user_facing, AppError, UserFacingErrorCode};

/// A project's book.
pub(crate) fn project_book(project: &Project) -> Book {
    Book::Project {
        id: project.id.clone(),
        name: project.name.clone(),
    }
}

/// The book the frontend names: the Inbox, or a project of the list. Any other id is refused.
fn book_of(app: &tauri::AppHandle, book: &str) -> anyhow::Result<Book> {
    if book == INBOX_BOOK {
        return Ok(Book::Inbox);
    }
    Ok(project_book(&app.state::<ProjectsState>().project(book)?))
}

/// Runs `work` with the notes and their files, off the async runtime.
async fn with_store<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    work: impl FnOnce(&tauri::AppHandle, &NotesStore, &NotesFiles) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        work(app, &app.state::<NotesStore>(), &app.state::<NotesFiles>())
    })
    .await
}

/// Runs `work` on a book's notes, once the book is known.
async fn with_notes<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    book: String,
    work: impl FnOnce(&NotesStore, &NotesFiles, &Book) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    with_store(command, app, move |app, store, files| {
        work(store, files, &book_of(app, &book)?)
    })
    .await
}

/// Runs a move into the book `to` names. A project made for it, without folder, goes again when
/// the move fails, with what was written for it; when the move is done the frontend is told the
/// list changed.
fn into_target<T>(
    app: &tauri::AppHandle,
    store: &NotesStore,
    files: &NotesFiles,
    to: BookTarget,
    run: impl FnOnce(&Book) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let name = match to {
        BookTarget::Book { book } => return run(&book_of(app, &book)?),
        BookTarget::NewProject { name } => name,
    };
    let projects = app.state::<ProjectsState>();
    let moved = into_new_project(
        || {
            let (project, _) = projects.update_with(app, |list| list.add(&name, None))?;
            Ok(project_book(&project))
        },
        run,
        |book| {
            store.delete_book(files, book)?;
            projects.update(app, |list| list.remove(book.key()))?;
            Ok(())
        },
    )?;
    let _ = app.emit(PROJECTS_CHANGED_EVENT, ProjectsChangedEvent::default());
    Ok(moved)
}

/// Runs `run` into a book `make` makes for it; `unmake` takes the book away when `run` fails.
fn into_new_project<T>(
    make: impl FnOnce() -> anyhow::Result<Book>,
    run: impl FnOnce(&Book) -> anyhow::Result<T>,
    unmake: impl FnOnce(&Book) -> anyhow::Result<()>,
) -> anyhow::Result<T> {
    let book = make()?;
    run(&book).inspect_err(|_| {
        if let Err(error) = unmake(&book) {
            tracing::warn!(error = %format!("{error:#}"), "a project made for a move stays");
        }
    })
}

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
/// Moves a note to another book, or another list of its own, keeping its id; `to` may be a
/// project made for it.
pub(crate) async fn move_note(
    app: tauri::AppHandle,
    from: String,
    id: String,
    to: BookTarget,
    list: ListTarget,
) -> Result<MovedNote, AppError> {
    with_store("move_note", app, move |app, store, files| {
        let from = book_of(app, &from)?;
        into_target(app, store, files, to, |to| {
            store.move_note(files, &from, &id, to, list)
        })
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
        let (at, home) = (book_of(app, &at)?, book_of(app, &home)?);
        store.unmove_note(files, &at, original, &home)
    })
    .await
}

#[tauri::command]
/// Moves a list with its notes to another project, which may be made for it; what comes back
/// undoes it.
pub(crate) async fn move_list(
    app: tauri::AppHandle,
    from: String,
    list: String,
    to: BookTarget,
) -> Result<MovedList, AppError> {
    with_store("move_list", app, move |app, store, files| {
        let from = book_of(app, &from)?;
        into_target(app, store, files, to, |to| {
            store.move_list(files, &from, &list, to)
        })
    })
    .await
}

#[tauri::command]
/// Brings a moved list back where it was, with its notes (undo).
pub(crate) async fn unmove_list(app: tauri::AppHandle, moved: MovedList) -> Result<(), AppError> {
    with_store("unmove_list", app, move |app, store, files| {
        let (from, to) = (book_of(app, &moved.from)?, book_of(app, &moved.to)?);
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

#[tauri::command]
/// What a book tells of its notes: a project's card at all projects.
pub(crate) async fn notes_summary(
    app: tauri::AppHandle,
    book: String,
) -> Result<NotesSummary, AppError> {
    with_notes("notes_summary", app, book, |store, files, book| {
        store.summary(files, book)
    })
    .await
}

#[tauri::command]
/// How many notes a book has, open and done: what removing a project would delete.
pub(crate) async fn count_notes(app: tauri::AppHandle, book: String) -> Result<u32, AppError> {
    with_notes("count_notes", app, book, |store, files, book| {
        Ok(store.count(files, book)? as u32)
    })
    .await
}

#[tauri::command]
/// Asks where to save a project's notes as Markdown and writes them there; the path written, or
/// `None` when cancelled. Never inside a project's repository: Sidekyk writes in none.
pub(crate) async fn export_notes(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<String>, AppError> {
    with_store("export_notes", app, move |app, store, files| {
        let projects = app.state::<ProjectsState>();
        let project = projects.project(&project_id)?;
        let texts = texts::current(app);
        let Some(path) = app
            .dialog()
            .file()
            .set_title(texts.export_notes)
            .set_file_name(texts.export_file.replace("{name}", &project.name))
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path: PathBuf = path.into_path()?;
        let list = projects.list();
        let inside = match wsl_path(&path) {
            Some((distro, path)) => list.holds_in_wsl(&distro, &path),
            None => list.holds(&path, resolved_path),
        };
        if inside {
            return Err(user_facing(UserFacingErrorCode::ExportInRepository));
        }
        let markdown = store.read_notes(files, &project_book(&project), |lists, notes| {
            to_markdown(&project.name, lists, notes, &texts.export)
        })?;
        write_chosen_file(&path, markdown.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    fn casa() -> anyhow::Result<Book> {
        Ok(Book::Project {
            id: "0123456789abcdef".into(),
            name: "Casa".into(),
        })
    }

    #[test]
    fn a_project_made_for_a_move_goes_when_the_move_fails() {
        let unmade = Cell::new(false);
        let failed = into_new_project(
            casa,
            |_| anyhow::bail!("disk full") as anyhow::Result<()>,
            |book| {
                assert_eq!(book.key(), "0123456789abcdef");
                unmade.set(true);
                Ok(())
            },
        );
        assert!(failed.is_err());
        assert!(unmade.get());
    }

    #[test]
    fn a_project_made_for_a_move_stays_when_it_is_done() {
        let moved = into_new_project(
            casa,
            |book| Ok(book.key().to_string()),
            |_| unreachable!("the move was done"),
        );
        assert_eq!(moved.unwrap(), "0123456789abcdef");
    }
}
