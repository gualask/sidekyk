//! The browser fixtures' Markdown previews (`src/dev/fixture-files/previews.json`), made by the
//! real parser so the fixtures show what the app shows. A Markdown file under `<project>/` is
//! read against that project's files; one under `edits/<project>/` is a later version of one of
//! them, for `sidekykDev.writeFile`. `SIDEKYK_UPDATE_FIXTURES=1 cargo test fixture_previews`
//! writes the file again after a fixture changed.

mod common;

use std::collections::BTreeMap;

use common::{files, fixture_files};
use sidekyk_core::modules::preview::{parse_markdown, MarkdownDocument};

const PREVIEWS: &str = "previews.json";

#[test]
fn fixture_previews_are_the_parsers() {
    let root = fixture_files();
    let mut sizes: BTreeMap<String, BTreeMap<String, u64>> = BTreeMap::new();
    let mut previews: BTreeMap<String, MarkdownDocument> = BTreeMap::new();
    // `images`: the repository's images and the git objects of their other sides
    for project in ["vault", "shop", "images"] {
        sizes.insert(project.into(), files(&root.join(project)));
    }
    for (folder, project) in [
        ("vault", "vault"),
        ("shop", "shop"),
        ("edits/vault", "vault"),
    ] {
        let tree = &sizes[project];
        for path in files(&root.join(folder)).into_keys() {
            if !path.ends_with(".md") {
                continue;
            }
            let text = std::fs::read_to_string(root.join(folder).join(&path)).unwrap();
            let document = parse_markdown(&text, &path, &|other| tree.contains_key(other), false);
            previews.insert(format!("{folder}/{path}"), document);
        }
    }
    let made = serde_json::to_string_pretty(&serde_json::json!({
        "sizes": sizes,
        "previews": previews,
    }))
    .unwrap()
        + "\n";

    let written = root.join(PREVIEWS);
    if std::env::var_os("SIDEKYK_UPDATE_FIXTURES").is_some() {
        std::fs::write(&written, &made).unwrap();
    }
    let stored = std::fs::read_to_string(&written).unwrap_or_default();
    assert!(
        stored == made,
        "{} is out of date: run `SIDEKYK_UPDATE_FIXTURES=1 cargo test --manifest-path \
         src-tauri/Cargo.toml -p sidekyk-core fixture_previews`",
        written.display()
    );
}
