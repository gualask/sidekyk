//! What crosses between the page and the backend without being JSON: the images the URI schemes
//! answer with, and a command's body that is a line of JSON, then raw bytes. A helper of the entry
//! points, none itself.

use std::borrow::Cow;

use serde::de::DeserializeOwned;
use tauri::http::{header, Response, StatusCode};

/// What a URI scheme answers with.
pub(super) type SchemeResponse = Response<Cow<'static, [u8]>>;

/// An image's bytes, `kind` their type. Nothing in them runs, an SVG opened alone included, and
/// the WebView keeps them for good: their URL names their bytes (a crop's id, an image's, a
/// file's stamp, a git object), so changed bytes are another URL.
pub(super) fn image(kind: &'static str, bytes: Vec<u8>) -> SchemeResponse {
    Response::builder()
        .header(header::CONTENT_TYPE, kind)
        .header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'",
        )
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(Cow::Owned(bytes))
        .unwrap_or_else(|_| not_found())
}

/// Nothing there: 404, no body.
pub(super) fn not_found() -> SchemeResponse {
    let mut response = Response::new(Cow::Borrowed(&[][..]));
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
}

/// A body that is a line of JSON, then raw bytes: the JSON read as a `T`, and the bytes after its
/// line. JSON escapes every line end inside it, so its line ends at the first.
pub(super) fn json_line<T: DeserializeOwned>(body: &[u8]) -> anyhow::Result<(T, &[u8])> {
    let end = body
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or_else(|| anyhow::anyhow!("the body's JSON ends its line"))?;
    Ok((serde_json::from_slice(&body[..end])?, &body[end + 1..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_is_answered_with_no_script_and_kept_for_good() {
        let response = image("image/svg+xml", b"<svg/>".to_vec());
        let header = |name| response.headers()[name].to_str().unwrap();
        assert_eq!(header(header::CONTENT_TYPE), "image/svg+xml");
        assert_eq!(
            header(header::CONTENT_SECURITY_POLICY),
            "default-src 'none'; style-src 'unsafe-inline'"
        );
        assert_eq!(header(header::X_CONTENT_TYPE_OPTIONS), "nosniff");
        assert_eq!(header(header::CACHE_CONTROL), "max-age=31536000, immutable");
        assert_eq!(response.body().as_ref(), b"<svg/>");
        assert_eq!(not_found().status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_body_is_a_line_of_json_then_the_bytes() {
        // a line end inside the JSON is escaped: the line ends at the first
        let json = r#"{"text":"A\nB"}"#;
        let png = [0x89, b'P', b'\n', b'G'];
        let body = [json.as_bytes(), b"\n", &png].concat();
        let (read, rest) = json_line::<serde_json::Value>(&body).unwrap();
        assert_eq!(read["text"], "A\nB");
        assert_eq!(rest, png);

        let (_, rest) = json_line::<serde_json::Value>(b"{}\n").unwrap();
        assert!(rest.is_empty());
        assert!(json_line::<serde_json::Value>(b"{}").is_err());
    }
}
