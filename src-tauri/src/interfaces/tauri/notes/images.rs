//! The commands on a note's images: added from files or pasted, marked, taken out, given as PNG.
//! Every command names a book: the Inbox, or a project of the list.

use super::super::blocking::{notes, ports, with_notes, with_store};
use sidekyk_core::modules::notes::{as_png, given_images, prepare, ImageTarget, Mark, Note};
use sidekyk_core::shared::error::AppError;
use sidekyk_core::shared::url::percent_decoded;

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
