//! The browser fixtures' Markdown previews (`src/dev/fixture-files/previews.json`), made by the
//! real parser so the fixtures show what the app shows. A Markdown file under `<project>/` is
//! read against that project's files; one under `edits/<project>/` is a later version of one of
//! them, for `sidekykDev.writeFile`. `SIDEKYK_UPDATE_FIXTURES=1 cargo test fixture_previews`
//! writes the file again after a fixture changed.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sidekyk_core::modules::preview::{parse_markdown, MarkdownDocument};

const PREVIEWS: &str = "previews.json";

fn fixture_files() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../src/dev/fixture-files")
}

/// Every file under `folder`, by its path from it with `/`, and its size.
fn files(folder: &Path) -> BTreeMap<String, u64> {
    let mut found = BTreeMap::new();
    let mut folders = vec![folder.to_path_buf()];
    while let Some(next) = folders.pop() {
        for entry in std::fs::read_dir(&next).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                folders.push(path);
                continue;
            }
            let relative = path.strip_prefix(folder).unwrap();
            let name: Vec<_> = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect();
            found.insert(name.join("/"), path.metadata().unwrap().len());
        }
    }
    found
}

#[test]
fn fixture_previews_are_the_parsers() {
    let root = fixture_files();
    let mut sizes: BTreeMap<String, BTreeMap<String, u64>> = BTreeMap::new();
    let mut previews: BTreeMap<String, MarkdownDocument> = BTreeMap::new();
    for project in ["vault", "shop"] {
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
