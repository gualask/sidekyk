//! Notes' images for the WebView, at `note-image://localhost/<book>/<file>`
//! (`http://note-image.localhost/…` on Windows): a card loads a thumbnail (`<id>.thumb.png`), the
//! viewer the image (`<id>.<ext>`), as any image, so the WebView decodes them itself and no copy
//! goes through the JS heap.

use std::borrow::Cow;

use tauri::http::{header, Response, StatusCode};
use tauri::{Manager, UriSchemeResponder};

use super::blocking::{notes, ports};
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::shared::url::percent_decoded;

pub(crate) const SCHEME: &str = "note-image";

/// Answers a request off the main thread: an image a note of the book has, or 404 with no body.
pub(crate) fn respond(app: &tauri::AppHandle, uri_path: &str, responder: UriSchemeResponder) {
    let Some((book, file)) = target(uri_path) else {
        tracing::debug!(uri_path, "not a note's image");
        responder.respond(not_found());
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<NotesStore>();
        let image = notes(&app)
            .book(&book)
            .and_then(|book| store.image(&*ports(&app).notes, &book, &file));
        responder.respond(match image {
            Ok(Some((kind, bytes))) => Response::builder()
                .header(header::CONTENT_TYPE, kind.mime())
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                // an image's id names its bytes for good
                .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                .body(Cow::Owned(bytes))
                .unwrap_or_else(|_| not_found()),
            Ok(None) => not_found(),
            Err(error) => {
                tracing::debug!(error = %format!("{error:#}"), "note image not read");
                not_found()
            }
        });
    });
}

/// The book and the file a request names: `/<book>/<file>`, which `convertFileSrc` encodes whole,
/// the book encoded once before (an older project id is its folder's path, slashes included).
fn target(uri_path: &str) -> Option<(String, String)> {
    let decoded = percent_decoded(uri_path.trim_start_matches('/'));
    let (book, file) = decoded.split_once('/')?;
    let book = percent_decoded(book);
    (!book.is_empty() && !file.is_empty() && !file.contains('/')).then(|| (book, file.into()))
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(Cow::Borrowed(&[][..]));
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_names_a_book_and_a_file() {
        assert_eq!(
            target("/inbox%2F00112233445566ff.thumb.png"),
            Some(("inbox".into(), "00112233445566ff.thumb.png".into()))
        );
        // an older id, its folder's path, encoded before the whole
        assert_eq!(
            target("/%252FUsers%252Fdev%252Fshop%2F00112233445566ff.jpg"),
            Some(("/Users/dev/shop".into(), "00112233445566ff.jpg".into()))
        );
        assert_eq!(target("/inbox"), None);
        assert_eq!(target("/inbox%2Fa%2Fb.png"), None);
        assert_eq!(target("/%2Fa.png"), None);
    }
}
