//! A project's folder without git: its files as the Files panel lists them, hidden by the rules
//! git would apply (`.gitignore`, git's global excludes) and by `.ignore`, without running git
//! (`RepositoryBackend::walk`, `folder_rules`).

mod changes;
mod open;
mod tree;

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::modules::repository::{existing_folder, RepositoryBackend};

pub use changes::FolderChanges;
pub use open::resolve_folder;
pub use tree::load_folder_tree;

/// What a project's folder is, found where it is read and never stored: a `git init` in it, or
/// its `.git` removed, changes it while the app runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderKind {
    /// A `.git` at its root (a folder, or a file for linked worktrees and submodules).
    Repository,
    /// Without git: Files and Notes, no Changes.
    Plain,
}

/// What the folder at `root` is, without git; one moved or deleted is `repository_missing`.
pub fn folder_kind(backend: &dyn RepositoryBackend, root: &Path) -> anyhow::Result<FolderKind> {
    existing_folder(backend, root)?;
    Ok(if backend.has_entry(root, Path::new(".git")) {
        FolderKind::Repository
    } else {
        FolderKind::Plain
    })
}

/// Never listed, wherever they are: version control's own folders and the files the OS leaves in
/// folders (the VCS folders and OS files of Zed's `file_scan_exclusions`).
const ALWAYS_HIDDEN: [&str; 9] = [
    ".git",
    ".hg",
    ".svn",
    ".jj",
    ".sl",
    ".repo",
    "CVS",
    ".DS_Store",
    "Thumbs.db",
];

/// Whether an entry of this name is never listed.
pub fn always_hidden(name: &std::ffi::OsStr) -> bool {
    ALWAYS_HIDDEN.iter().any(|hidden| name == *hidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_kind_goes_as_the_frontend_names_it() {
        assert_eq!(
            serde_json::to_value(FolderKind::Repository).unwrap(),
            "repository"
        );
        assert_eq!(serde_json::to_value(FolderKind::Plain).unwrap(), "plain");
    }
}
