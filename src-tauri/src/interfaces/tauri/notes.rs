//! Tauri adapters for notes. Every command names a book: the Inbox, or a project of the list.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::blocking::blocking;
use super::state::ProjectsState;
use super::texts;
use crate::infrastructure::files::write_whole;
use crate::infrastructure::notes_files::{read_image_file, resolved_path, NotesFiles};
use sidekyk_core::infrastructure::machines::wsl::{linux_path, wsl_path};
use sidekyk_core::modules::notes::{
    as_png, image_file, prepare, to_markdown, Book, DeletedList, ImageTarget, ListTarget, Mark,
    MovedList, MovedNote, Note, NoteList, NotesCount, NotesStore, ProjectNotes, EXPORT_IMAGES,
    INBOX_BOOK, MAX_IMAGE_BYTES,
};
use sidekyk_core::modules::projects::{Location, Project};
use sidekyk_core::shared::error::{user_facing, AppError, UserFacingErrorCode};
use sidekyk_core::shared::sync::lock;
use sidekyk_core::shared::url::percent_decoded;

/// A project's book.
pub(crate) fn project_book(project: &Project) -> Book {
    Book::Project {
        id: project.id.clone(),
        name: project.name.clone(),
    }
}

/// The book the frontend names: the Inbox, or a project of the list. Any other id is refused.
pub(super) fn book_of(app: &tauri::AppHandle, book: &str) -> anyhow::Result<Book> {
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
pub(super) async fn with_notes<T: Send + 'static>(
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
    with_notes(
        "add_note_image_files",
        app,
        book,
        move |store, files, book| {
            let images = paths
                .iter()
                .map(|path| prepare(read_image_file(Path::new(path), MAX_IMAGE_BYTES)?))
                .collect::<anyhow::Result<Vec<_>>>()?;
            store.add_images(files, book, target, images)
        },
    )
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
    with_store("copy_note", app, move |app, store, files| {
        let book = book_of(app, &book)?;
        let (text, images) = store.note_copy(files, &book, &id)?;
        let images = match wsl_distro(app, &book)? {
            Some(distro) => in_distro(&distro, files.root(), images)?,
            None => images,
        };
        Ok(copy_text(&text, &images))
    })
    .await
}

/// A note's text, then its images' paths, a line each; without images, the text as it is.
fn copy_text(text: &str, images: &[String]) -> String {
    if images.is_empty() {
        return text.to_string();
    }
    let paths = images.join("\n");
    match text.trim_end() {
        "" => paths,
        text => format!("{text}\n\n{paths}"),
    }
}

/// The distro a book's project is in, if it is a WSL project's.
fn wsl_distro(app: &tauri::AppHandle, book: &Book) -> anyhow::Result<Option<String>> {
    let Book::Project { id, .. } = book else {
        return Ok(None);
    };
    let project = app.state::<ProjectsState>().project(id)?;
    Ok(project
        .folders
        .into_iter()
        .find_map(|folder| match folder.location {
            Location::Wsl { distro, .. } => Some(distro),
            Location::Local { .. } => None,
        }))
}

/// How a distro names the notes' folder, asked once (`wslpath`) and kept: one `wsl.exe` per
/// distro and session, not one per copy.
static NOTES_IN_DISTRO: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Paths under the notes' folder (`root`) as `distro` names them.
fn in_distro(distro: &str, root: &Path, paths: Vec<String>) -> anyhow::Result<Vec<String>> {
    let known = lock(&NOTES_IN_DISTRO)
        .as_ref()
        .and_then(|roots| roots.get(distro).cloned());
    let linux_root = match known {
        Some(linux_root) => linux_root,
        None => {
            let linux_root = linux_path(distro, root)?;
            lock(&NOTES_IN_DISTRO)
                .get_or_insert_with(HashMap::new)
                .insert(distro.into(), linux_root.clone());
            linux_root
        }
    };
    paths
        .iter()
        .map(|path| under_linux_root(&linux_root, root, Path::new(path)))
        .collect()
}

/// `path`, under `root`, as under `linux_root`: its parts joined by `/`.
fn under_linux_root(linux_root: &str, root: &Path, path: &Path) -> anyhow::Result<String> {
    let inside = path.strip_prefix(root)?;
    let parts: Vec<String> = inside
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    Ok(format!(
        "{}/{}",
        linux_root.trim_end_matches('/'),
        parts.join("/")
    ))
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
        let (from, to) = (book_of(app, &from)?, book_of(app, &to)?);
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
        let (at, home) = (book_of(app, &at)?, book_of(app, &home)?);
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
        let (from, to) = (book_of(app, &from)?, book_of(app, &to)?);
        store.move_list(files, &from, &list, &to)
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
    with_store("export_notes", app, move |app, store, files| {
        let projects = app.state::<ProjectsState>();
        let project = projects.project(&project_id)?;
        let book = project_book(&project);
        let texts = texts::current();
        let images: Vec<String> = store.with_notes(files, &book, |_, notes| {
            notes
                .iter()
                .flat_map(|note| note.images.iter().map(image_file))
                .collect()
        })?;
        let file_name = texts.export_file.replace("{name}", &project.name);
        let dialog = app.dialog().file().set_title(texts.export_notes);
        let dialog = if images.is_empty() {
            dialog
                .set_file_name(&file_name)
                .add_filter("Markdown", &["md"])
        } else {
            dialog.set_file_name(file_name.trim_end_matches(".md"))
        };
        let Some(path) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path: PathBuf = path.into_path()?;
        let list = projects.list();
        let inside = match wsl_path(&path) {
            Some((distro, path)) => list.holds_in_wsl(&distro, &path),
            None => list.holds(&path, resolved_path, projects.name_case()),
        };
        if inside {
            return Err(user_facing(UserFacingErrorCode::ExportInRepository));
        }
        let markdown = store.with_notes(files, &book, |lists, notes| {
            to_markdown(&project.name, lists, notes, &texts.export)
        })?;
        if images.is_empty() {
            write_whole(&path, markdown.as_bytes())?;
            return Ok(Some(path.to_string_lossy().into_owned()));
        }
        // a folder: the name chosen names the Markdown file in it too
        let name = path.file_name().map_or_else(
            || file_name.trim_end_matches(".md").to_string(),
            |name| name.to_string_lossy().into_owned(),
        );
        let folder = path.join(EXPORT_IMAGES);
        write_whole(&path.join(format!("{name}.md")), markdown.as_bytes())?;
        for image in &images {
            // one at a time: an export holds one image in memory at most
            if let Some((_, bytes)) = store.image(files, &book, image)? {
                write_whole(&folder.join(image), &bytes)?;
            }
        }
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

    #[test]
    fn a_copy_is_the_text_then_a_line_per_image() {
        let images = ["/n/a.png".to_string(), "/n/b.jpg".to_string()];
        assert_eq!(copy_text("look\n", &images), "look\n\n/n/a.png\n/n/b.jpg");
        assert_eq!(copy_text("  \n", &images[..1]), "/n/a.png");
        assert_eq!(copy_text("only text\n", &[]), "only text\n");
    }

    #[test]
    fn a_path_under_the_notes_is_named_as_a_distro_names_the_notes() {
        let root = Path::new("/data/notes");
        assert_eq!(
            under_linux_root(
                "/mnt/c/Users/me/AppData/notes/",
                root,
                &root.join("shop-3f9a2c").join("00112233445566ff.png")
            )
            .unwrap(),
            "/mnt/c/Users/me/AppData/notes/shop-3f9a2c/00112233445566ff.png"
        );
        assert!(under_linux_root("/mnt/c", root, Path::new("/elsewhere/a.png")).is_err());
    }
}
