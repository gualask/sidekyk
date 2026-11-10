//! Tauri adapters for notes. Every command names a book: the Inbox, or a project of the list.

use std::path::PathBuf;

use tauri_plugin_dialog::DialogExt;

use super::blocking::{blocking, notes, ports, with_notes, with_store};
use crate::desktop::texts;
use sidekyk_core::modules::notes::{
    as_png, given_images, prepare, DeletedList, ImageTarget, ListTarget, Mark, MovedList,
    MovedNote, Note, NoteList, NotesCount, ProjectNotes,
};
use sidekyk_core::shared::error::AppError;
use sidekyk_core::shared::url::percent_decoded;

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
/// Adds the image files dropped on a note, or on the field that writes a new one: all of them, or
/// none when one is refused.
pub(crate) async fn add_note_image_files(
    app: tauri::AppHandle,
    book: String,
    target: ImageTarget,
    paths: Vec<String>,
) -> Result<Note, AppError> {
    with_store("add_note_image_files", app, move |app, store, files| {
        let book = notes(app).book(&book)?;
        let images = given_images(&*ports(app).given, &paths)?;
        store.add_images(files, &book, target, images)
    })
    .await
}

#[tauri::command]
/// Adds an image pasted: its bytes are the request's body, so they cross as they are; the book
/// (percent-encoded) and the target are its headers.
pub(crate) async fn add_note_image(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Note, AppError> {
    let (book, target, bytes) = pasted(&request).map_err(AppError::from)?;
    with_notes("add_note_image", app, book, move |store, files, book| {
        store.add_images(files, book, target, vec![prepare(bytes)?])
    })
    .await
}

/// A pasted image's book, target and bytes, from its request.
fn pasted(request: &tauri::ipc::Request<'_>) -> anyhow::Result<(String, ImageTarget, Vec<u8>)> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        anyhow::bail!("an image's bytes come raw");
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| anyhow::anyhow!("no {name} header"))
    };
    let book = percent_decoded(header("x-book")?);
    let target = serde_json::from_str(header("x-target")?)?;
    Ok((book, target, bytes.clone()))
}

/// What marks a note's image, before the PNG drawn with them: the body's first line.
#[derive(Debug, serde::Deserialize)]
struct Marking {
    book: String,
    id: String,
    image: String,
    marks: Vec<Mark>,
}

#[tauri::command]
/// Marks a note's image anew, or gives the image under its marks back when there are none. The
/// body is the marking as JSON, a line of its own (JSON escapes every line end in it), then the
/// PNG drawn with the marks, raw: none without marks.
pub(crate) async fn mark_note_image(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Note, AppError> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(anyhow::anyhow!("a marking comes raw").into());
    };
    let (marking, png) = marking(body).map_err(AppError::from)?;
    let Marking {
        book,
        id,
        image,
        marks,
    } = marking;
    with_notes("mark_note_image", app, book, move |store, files, book| {
        let drawn = (!png.is_empty()).then(|| prepare(png)).transpose()?;
        store.mark_image(files, book, &id, &image, marks, drawn)
    })
    .await
}

/// A marking's JSON and its PNG, from the body that carries them.
fn marking(body: &[u8]) -> anyhow::Result<(Marking, Vec<u8>)> {
    let end = body
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or_else(|| anyhow::anyhow!("a marking ends its line"))?;
    Ok((
        serde_json::from_slice(&body[..end])?,
        body[end + 1..].to_vec(),
    ))
}

#[tauri::command]
/// Takes an image out of a note; its files stay for an undo (`restore_note`).
pub(crate) async fn remove_note_image(
    app: tauri::AppHandle,
    book: String,
    id: String,
    image: String,
) -> Result<Note, AppError> {
    with_notes("remove_note_image", app, book, move |store, files, book| {
        store.remove_image(files, book, &id, &image)
    })
    .await
}

#[tauri::command]
/// An image of a note as PNG, by its file's name: what "Copy image" puts on the clipboard, which
/// takes PNG everywhere. Raw bytes, not a JSON array.
pub(crate) async fn note_image_png(
    app: tauri::AppHandle,
    book: String,
    file: String,
) -> Result<tauri::ipc::Response, AppError> {
    with_notes("note_image_png", app, book, move |store, files, book| {
        let (kind, bytes) = store
            .image(files, book, &file)?
            .ok_or_else(|| anyhow::anyhow!("no image {file} in this book"))?;
        Ok(tauri::ipc::Response::new(as_png(kind, bytes)?))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_marking_is_a_line_of_json_then_the_png() {
        let json = r#"{"book":"inbox","id":"a","image":"b","marks":[{"x":1,"y":2,"text":"A\nB","tail":null}]}"#;
        let png = [0x89, b'P', b'\n', b'G'];
        let (read, drawn) = marking(&[json.as_bytes(), b"\n", &png].concat()).unwrap();
        assert_eq!(
            (read.book.as_str(), read.id.as_str(), read.image.as_str()),
            ("inbox", "a", "b")
        );
        assert_eq!(read.marks[0].text, "A\nB");
        assert_eq!(drawn, png);

        let (read, drawn) = marking(
            br#"{"book":"inbox","id":"a","image":"b","marks":[]}
"#,
        )
        .unwrap();
        assert!(read.marks.is_empty() && drawn.is_empty());
        assert!(marking(b"{}").is_err());
    }
}
