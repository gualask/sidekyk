//! Where a Markdown file's links and images lead, and the ids of its headings: decided here, so
//! the frontend only follows what it is given.

use std::collections::HashMap;

use super::contracts::Target;
use crate::shared::url::percent_decoded;

/// Ids taken from a file are prefixed, as GitHub does, so a heading never takes the id of one of
/// the app's own elements (`# Root` is not `root`).
const ID_PREFIX: &str = "user-content-";

/// Images the preview shows, by extension, with their media type: those WKWebView, WebKitGTK and
/// WebView2 all decode (the frontend's `previewKind` knows the same).
const IMAGE_TYPES: [(&str, &str); 8] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
    ("svg", "image/svg+xml"),
];

/// Schemes a link may open outside the app; any other is shown as text.
const WEB_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// An image written into the file.
const DATA_IMAGE: &str = "data:image/";

/// The media type of an image the preview shows, by its extension; none for any other file.
pub fn image_type(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (_, extension) = name.rsplit_once('.')?;
    IMAGE_TYPES
        .iter()
        .find(|(known, _)| known.eq_ignore_ascii_case(extension))
        .map(|&(_, media)| media)
}

/// Headings' ids by GitHub's rule (github-slugger): lowercase, punctuation dropped but `-` and
/// `_`, spaces to `-`; a repeated one gains `-1`, `-2`.
#[derive(Default)]
pub struct Slugger {
    occurrences: HashMap<String, u32>,
}

impl Slugger {
    pub fn id(&mut self, heading: &str) -> String {
        let slug: String = heading
            .to_lowercase()
            .chars()
            .filter_map(|c| match c {
                ' ' => Some('-'),
                '-' | '_' => Some(c),
                c if c.is_alphanumeric() => Some(c),
                _ => None,
            })
            .collect();
        let mut id = slug.clone();
        while self.occurrences.contains_key(&id) {
            let count = self
                .occurrences
                .get_mut(&slug)
                .expect("the slug was taken first");
            *count += 1;
            id = format!("{slug}-{count}");
        }
        self.occurrences.insert(id.clone(), 0);
        format!("{ID_PREFIX}{id}")
    }
}

/// Whether a URL may open outside the app: `http`, `https`, `mailto`, case ignored.
pub fn is_web_url(url: &str) -> bool {
    scheme(url).is_some_and(web_scheme)
}

/// A link's target, from the Markdown file at `file`; `is_file` says whether a path is a file of
/// the project's tree. None: shown as text.
pub fn link_target(url: &str, file: &str, is_file: &dyn Fn(&str) -> bool) -> Option<Target> {
    if let Some(fragment) = url.strip_prefix('#') {
        return Some(Target::Anchor {
            id: anchor_id(fragment),
        });
    }
    if let Some(scheme) = scheme(url) {
        return web_scheme(scheme).then(|| Target::Web { url: url.into() });
    }
    let (path, anchor) = local_path(url, file)?;
    // the same file at one of its elements: a heading of the document shown
    if let (true, Some(fragment)) = (path == file, anchor) {
        return Some(Target::Anchor {
            id: anchor_id(fragment),
        });
    }
    Some(if is_file(&path) {
        Target::File {
            path,
            anchor: anchor.map(anchor_id),
        }
    } else {
        Target::Missing { path }
    })
}

/// An image's target: a file of the tree with an image's extension, an image written into the
/// file, or one on the web, never loaded.
pub fn image_target(url: &str, file: &str, is_file: &dyn Fn(&str) -> bool) -> Option<Target> {
    if let Some(scheme) = scheme(url) {
        return if scheme.eq_ignore_ascii_case("data") {
            let image = url
                .get(..DATA_IMAGE.len())
                .is_some_and(|head| head.eq_ignore_ascii_case(DATA_IMAGE));
            image.then(|| Target::Data { url: url.into() })
        } else {
            let web = scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https");
            web.then(|| Target::Web { url: url.into() })
        };
    }
    let (path, _) = local_path(url, file)?;
    Some(if image_type(&path).is_some() && is_file(&path) {
        Target::File { path, anchor: None }
    } else {
        Target::Missing { path }
    })
}

/// The element id a fragment names.
fn anchor_id(fragment: &str) -> String {
    format!("{ID_PREFIX}{}", percent_decoded(fragment))
}

fn web_scheme(scheme: &str) -> bool {
    WEB_SCHEMES
        .iter()
        .any(|known| known.eq_ignore_ascii_case(scheme))
}

/// A URL's scheme (RFC 3986: a letter, then letters, digits, `+`, `-`, `.`), if it has one.
fn scheme(url: &str) -> Option<&str> {
    let (scheme, _) = url.split_once(':')?;
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then_some(scheme)
}

/// A relative URL as a path of the project, with its fragment: from the file's folder, or from
/// the root after a leading `/` (as GitHub); none for a protocol-relative URL, a path above the
/// root, or the root itself.
fn local_path<'a>(url: &'a str, file: &str) -> Option<(String, Option<&'a str>)> {
    if url.starts_with("//") {
        return None;
    }
    let (rest, anchor) = match url.split_once('#') {
        Some((rest, anchor)) => (rest, Some(anchor)),
        None => (url, None),
    };
    let rest = rest.split_once('?').map_or(rest, |(path, _)| path);
    // `[text]()`: nowhere
    if rest.is_empty() {
        return None;
    }
    let relative = percent_decoded(rest);
    let mut parts: Vec<&str> = if relative.starts_with('/') {
        Vec::new()
    } else {
        let mut folder: Vec<&str> = file.split('/').collect();
        folder.pop();
        folder
    };
    for part in relative.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| (parts.join("/"), anchor))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(path: &str) -> bool {
        [
            "README.md",
            "docs/setup.md",
            "docs/my file.md",
            "img/logo.png",
            "docs/notes.txt",
        ]
        .contains(&path)
    }

    fn file(path: &str, anchor: Option<&str>) -> Option<Target> {
        Some(Target::File {
            path: path.into(),
            anchor: anchor.map(Into::into),
        })
    }

    #[test]
    fn headings_take_github_slugs_and_repeats_a_number() {
        let mut slugger = Slugger::default();
        assert_eq!(
            slugger.id("Getting Started!"),
            "user-content-getting-started"
        );
        assert_eq!(
            slugger.id("Getting started"),
            "user-content-getting-started-1"
        );
        assert_eq!(
            slugger.id("getting-started-1"),
            "user-content-getting-started-1-1"
        );
        assert_eq!(slugger.id("API: `run()` & co."), "user-content-api-run--co");
        assert_eq!(slugger.id("Perché è così"), "user-content-perché-è-così");
        assert_eq!(slugger.id("snake_case"), "user-content-snake_case");
    }

    #[test]
    fn links_lead_to_anchors_files_of_the_tree_or_the_web() {
        let at = |url| link_target(url, "docs/guide.md", &tree);
        assert_eq!(
            at("#install"),
            Some(Target::Anchor {
                id: "user-content-install".into()
            })
        );
        assert_eq!(at("setup.md"), file("docs/setup.md", None));
        assert_eq!(
            at("./setup.md#run"),
            file("docs/setup.md", Some("user-content-run"))
        );
        assert_eq!(at("../README.md"), file("README.md", None));
        assert_eq!(at("/README.md?plain=1"), file("README.md", None));
        assert_eq!(at("my%20file.md"), file("docs/my file.md", None));
        assert_eq!(
            at("guide.md#install"),
            Some(Target::Anchor {
                id: "user-content-install".into()
            })
        );
        assert_eq!(at(""), None);
        assert_eq!(at("?plain=1"), None);
        assert_eq!(
            at("gone.md"),
            Some(Target::Missing {
                path: "docs/gone.md".into()
            })
        );
        assert_eq!(
            at("HTTPS://example.com/a"),
            Some(Target::Web {
                url: "HTTPS://example.com/a".into()
            })
        );
        assert_eq!(
            at("mailto:a@b.c"),
            Some(Target::Web {
                url: "mailto:a@b.c".into()
            })
        );
    }

    #[test]
    fn links_never_lead_above_the_root_nor_to_other_schemes() {
        let at = |url| link_target(url, "docs/guide.md", &tree);
        assert_eq!(at("../../etc/passwd"), None);
        assert_eq!(at("/"), None);
        assert_eq!(at("//evil.com/x"), None);
        assert_eq!(at("javascript:alert(1)"), None);
        assert_eq!(at("JavaScript:alert(1)"), None);
        assert_eq!(at("file:///etc/passwd"), None);
        assert_eq!(at("vscode://open"), None);
        assert_eq!(at("data:text/html,x"), None);
        // not a scheme, so a path: never a URL
        assert_eq!(
            at("java\tscript:x"),
            Some(Target::Missing {
                path: "docs/java\tscript:x".into()
            })
        );
    }

    #[test]
    fn images_are_files_of_the_tree_written_in_or_on_the_web() {
        let at = |url| image_target(url, "docs/guide.md", &tree);
        assert_eq!(at("../img/logo.png"), file("img/logo.png", None));
        assert_eq!(
            at("notes.txt"),
            Some(Target::Missing {
                path: "docs/notes.txt".into()
            })
        );
        assert_eq!(
            at("https://img.shields.io/x.svg"),
            Some(Target::Web {
                url: "https://img.shields.io/x.svg".into()
            })
        );
        assert_eq!(
            at("data:image/png;base64,AAAA"),
            Some(Target::Data {
                url: "data:image/png;base64,AAAA".into()
            })
        );
        assert_eq!(at("data:text/html,x"), None);
        assert_eq!(at("mailto:a@b.c"), None);
    }

    #[test]
    fn only_web_and_mail_addresses_open_outside() {
        assert!(is_web_url("https://example.com"));
        assert!(is_web_url("MAILTO:a@b.c"));
        assert!(!is_web_url("file:///etc/passwd"));
        assert!(!is_web_url("javascript:alert(1)"));
        assert!(!is_web_url("docs/a.md"));
        assert!(!is_web_url("tel:123"));
    }

    #[test]
    fn images_are_known_by_extension() {
        assert_eq!(image_type("a/b.PNG"), Some("image/png"));
        assert_eq!(image_type("x.svg"), Some("image/svg+xml"));
        assert_eq!(image_type("x.avif"), None);
        assert_eq!(image_type("png"), None);
        assert_eq!(image_type("a.png/readme"), None);
    }
}
