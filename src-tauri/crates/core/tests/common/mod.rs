//! What the fixture tests share: where the frontend's sources and fixtures are, and their files.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// The frontend's sources (`src/`).
pub fn src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../src")
}

/// The browser fixtures' files (`src/infrastructure/fixtures/fixture-files/`).
pub fn fixture_files() -> PathBuf {
    src().join("infrastructure/fixtures/fixture-files")
}

/// Every file under `folder`, by its path from it with `/`, and its size.
pub fn files(folder: &Path) -> BTreeMap<String, u64> {
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
