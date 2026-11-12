//! A project's folder, with or without git: the port to the machine that holds it, its files as
//! the Files panel lists them, which of a watcher's changes show and which folders are watched,
//! and its wire contracts. Without git, its files are hidden by the rules git would apply
//! (`.gitignore`, git's global excludes) and by `.ignore`, without running git
//! (`RepositoryBackend::walk`, `folder_rules`). `repository` (git's review) builds on it, never
//! the other way.

mod contracts;
#[cfg(test)]
mod fake;
mod name_order;
mod open;
mod ports;
mod reading;
mod tree;
mod watch;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub use contracts::{
    Directory, FileContent, FileStamp, RecentFile, RecentFiles, RepositoryChange,
    RepositoryChangedEvent, RepositoryInfo, TreeEntry, REPOSITORY_CHANGED_EVENT,
};

#[cfg(test)]
pub(crate) use fake::FakeBackend;
pub use name_order::compare_names;
pub use open::{
    existing_folder, existing_root, repositories_inside, repository_name, resolve_folder,
    resolve_repository,
};
pub use ports::{
    git_checked, joined, Changed, FolderAdded, FolderRules, FolderWatcher, GitOutput,
    RepositoryBackend, RepositoryWatcher, Walked, Watch, WorktreeEntry, LITERAL_PATHSPECS,
};
pub use reading::{
    checked_path, cut_at_line, load_file_content, load_file_stamp, load_image, looks_binary,
    MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_TREE_PATHS,
};
pub use tree::{load_file_tree, load_folder_tree, load_recent_files, FileTree};
pub use watch::{
    classify, FolderChanges, Hiding, IgnoredPaths, Visible, WatchedChanges, WatchedFolders,
};

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
