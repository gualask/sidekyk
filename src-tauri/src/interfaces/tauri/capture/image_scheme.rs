//! A draft's crops for the WebView, at `capture-image://localhost/<crop>.png` and
//! `<crop>.thumb.png` (`http://capture-image.localhost/…` on Windows): a crop is no book's until
//! its note is written, so `note-image` has none (`notes/image_scheme.rs`).

use std::borrow::Cow;

use tauri::http::{header, Response, StatusCode};
use tauri::UriSchemeResponder;

use crate::desktop::capture;

pub(crate) const SCHEME: &str = "capture-image";

/// Answers a request off the main thread, a crop's bytes copied there: a crop held, or 404 with
/// no body.
pub(crate) fn respond(app: &tauri::AppHandle, uri_path: &str, responder: UriSchemeResponder) {
    let Some((crop, thumb)) = target(uri_path) else {
        tracing::debug!(uri_path, "not a crop");
        responder.respond(not_found());
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let image = capture::crops(&app, &[crop])
            .ok()
            .and_then(|mut crops| crops.pop());
        responder.respond(match image {
            Some(image) if thumb => found(image.thumb.clone()),
            Some(image) => found(image.original.clone()),
            None => not_found(),
        });
    });
}

/// The crop a request names, and whether its thumbnail: `/<crop>.png`, `/<crop>.thumb.png`.
fn target(uri_path: &str) -> Option<(String, bool)> {
    let file = uri_path.trim_start_matches('/');
    let (crop, thumb) = match file.strip_suffix(".thumb.png") {
        Some(crop) => (crop, true),
        None => (file.strip_suffix(".png")?, false),
    };
    let named = !crop.is_empty() && crop.chars().all(|c| c.is_ascii_alphanumeric());
    named.then(|| (crop.into(), thumb))
}

/// A crop's PNG, kept by the WebView for good: a crop's id names its bytes.
fn found(bytes: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .header(header::CONTENT_TYPE, "image/png")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(Cow::Owned(bytes))
        .unwrap_or_else(|_| not_found())
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
    fn a_request_names_a_crop_or_its_thumbnail() {
        assert_eq!(
            target("/00112233445566ff.png"),
            Some(("00112233445566ff".into(), false))
        );
        assert_eq!(
            target("/00112233445566ff.thumb.png"),
            Some(("00112233445566ff".into(), true))
        );
        assert_eq!(target("/00112233445566ff.jpg"), None);
        assert_eq!(target("/a/b.png"), None);
        assert_eq!(target("/.png"), None);
    }
}
