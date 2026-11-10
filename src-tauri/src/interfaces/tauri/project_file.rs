//! A project's images for the WebView, at `project-file://localhost/<folderId>/<path>`
//! (`http://project-file.localhost/…` on Windows): the viewer and the Markdown preview load them
//! as any image, so the WebView decodes them itself and no copy goes through the JS heap. The
//! file of the tree, or with `?blob=<id>` that git object, a side of the image's diff.

use std::borrow::Cow;

use sidekyk_core::modules::preview::image_type;
use sidekyk_core::shared::url::percent_decoded;
use tauri::http::{header, Response, StatusCode};
use tauri::UriSchemeResponder;

use super::blocking::on_folder;
use sidekyk_core::app::machines::Start;

pub(crate) const SCHEME: &str = "project-file";

/// Answers a request off the main thread: the image of a project's tree or of git, or 404 with no
/// body. What a file holds never runs: an SVG opened alone gets a policy that allows no script.
pub(crate) fn respond(
    app: &tauri::AppHandle,
    uri_path: &str,
    query: Option<&str>,
    responder: UriSchemeResponder,
) {
    let Some((folder_id, path)) = target(uri_path) else {
        tracing::debug!(uri_path, "not a project's file");
        responder.respond(not_found());
        return;
    };
    // the core reads only images it knows the type of
    let Some(kind) = image_type(&path) else {
        responder.respond(not_found());
        return;
    };
    let blob = query.and_then(blob);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // a project shown is read: this never starts a stopped WSL distro
        let image = on_folder("project_file", app, folder_id, Start::Never, move |on| {
            on.reader.image(&on.info, &path, blob.as_deref())
        })
        .await;
        responder.respond(match image {
            Ok(bytes) => Response::builder()
                .header(header::CONTENT_TYPE, kind)
                .header(
                    header::CONTENT_SECURITY_POLICY,
                    "default-src 'none'; style-src 'unsafe-inline'",
                )
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                // the URL names the file's stamp or the object: changed bytes are another URL
                .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                .body(Cow::Owned(bytes))
                .unwrap_or_else(|_| not_found()),
            Err(_) => not_found(),
        });
    });
}

/// The folder and the path a request names: `/<folderId>/<path>`, which `convertFileSrc`
/// encodes whole, the id encoded once before (an id is opaque: an older one is its folder's path,
/// slashes included).
fn target(uri_path: &str) -> Option<(String, String)> {
    let decoded = percent_decoded(uri_path.trim_start_matches('/'));
    let (folder_id, path) = decoded.split_once('/')?;
    (!folder_id.is_empty() && !path.is_empty()).then(|| (percent_decoded(folder_id), path.into()))
}

/// The object a query names (`blob=<id>`), checked by the core before git reads it.
fn blob(query: &str) -> Option<String> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("blob="))
        .map(percent_decoded)
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
    fn a_request_names_a_project_and_a_path_encoded_whole() {
        assert_eq!(
            target("/b0000000000000a1%2Fdocs%2Fmy%20logo.png"),
            Some(("b0000000000000a1".into(), "docs/my logo.png".into()))
        );
        // an older id, its folder's path, encoded before the whole
        assert_eq!(
            target("/%252FUsers%252Fdev%252Fshop%2Fmedia%2F100%25.png"),
            Some(("/Users/dev/shop".into(), "media/100%.png".into()))
        );
        assert_eq!(target("/b0000000000000a1"), None);
        assert_eq!(target("/"), None);
    }

    #[test]
    fn a_query_may_name_a_git_object() {
        assert_eq!(blob("blob=ab12"), Some("ab12".into()));
        assert_eq!(blob("v=1-2&blob=ab12"), Some("ab12".into()));
        assert_eq!(blob("v=1761000000000-2048"), None);
    }
}
