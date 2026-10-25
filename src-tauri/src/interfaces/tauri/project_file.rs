//! A project's images for the WebView, at `project-file://localhost/<projectId>/<path>`
//! (`http://project-file.localhost/…` on Windows): the viewer and the Markdown preview load them
//! as any image, so the WebView decodes them itself and no copy goes through the JS heap.

use std::borrow::Cow;

use sidekyk_core::modules::preview::image_type;
use sidekyk_core::shared::url::percent_decoded;
use tauri::http::{header, Response, StatusCode};
use tauri::UriSchemeResponder;

use super::repository::on_project;

pub(crate) const SCHEME: &str = "project-file";

/// Answers a request off the main thread: the image of a project's tree, or 404 with no body.
/// What a file holds never runs: an SVG opened alone gets a policy that allows no script.
pub(crate) fn respond(app: &tauri::AppHandle, uri_path: &str, responder: UriSchemeResponder) {
    let Some((project_id, path)) = target(uri_path) else {
        tracing::debug!(uri_path, "not a project's file");
        responder.respond(not_found());
        return;
    };
    // the core reads only images it knows the type of
    let Some(kind) = image_type(&path) else {
        responder.respond(not_found());
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let image = on_project("project_file", app, project_id, move |on| {
            // a project shown is read: this never starts a stopped WSL distro
            on.readable_without_starting()?;
            on.repositories.image(on.info, &path)
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
                // the URL names the file's stamp: a changed file is another URL
                .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                .body(Cow::Owned(bytes))
                .unwrap_or_else(|_| not_found()),
            Err(_) => not_found(),
        });
    });
}

/// The project and the path a request names: `/<projectId>/<path>`, which `convertFileSrc`
/// encodes whole, the id encoded once before (an id is opaque: an older one is its folder's path,
/// slashes included).
fn target(uri_path: &str) -> Option<(String, String)> {
    let decoded = percent_decoded(uri_path.trim_start_matches('/'));
    let (project_id, path) = decoded.split_once('/')?;
    (!project_id.is_empty() && !path.is_empty()).then(|| (percent_decoded(project_id), path.into()))
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
}
