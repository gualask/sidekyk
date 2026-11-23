//! The files of each project, as the Files panel shows them: read when first asked for, kept
//! until they may have changed, the read in flight shared.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use super::LocalRepositories;
use crate::modules::folder::{self, Directory, FileTree, FolderKind, RepositoryInfo};
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::sync::lock;

/// A project's files, as the Files panel shows them.
#[derive(Default)]
pub(super) struct CachedTree {
    pub(super) tree: Option<Arc<FileTree>>,
    /// Counts the times the files may have changed, so a tree read meanwhile is not kept.
    pub(super) changes: u64,
    /// The ignored folders the Files panel read since the tree was: their changes show. Asked
    /// again for those still open once the tree is read again.
    pub(super) opened: HashSet<String>,
}

impl CachedTree {
    /// The files may have changed: the tree is read again when next asked for, and one read
    /// meanwhile is not kept.
    pub(super) fn forget(&mut self) {
        self.tree = None;
        self.changes += 1;
        self.opened.clear();
    }
}

impl LocalRepositories {
    /// A project's files, read again only when they may have changed, sharing the read in flight:
    /// those git lists in a repository, those the walk lists in a folder without git.
    /// The project's tree when `path` is a file the Files panel shows (one of the tree, or one the
    /// rules hide), else `file_missing`: never one always hidden.
    pub(super) fn tree_holding(
        &self,
        info: &RepositoryInfo,
        path: &str,
    ) -> anyhow::Result<Arc<FileTree>> {
        let tree = self.file_tree(info)?;
        if tree.shows_file(path) {
            Ok(tree)
        } else {
            Err(user_facing(UserFacingErrorCode::FileMissing))
        }
    }

    /// A folder's tree as it is on disk now: git's, or the walk of a folder without git.
    pub(super) fn read_tree(&self, info: &RepositoryInfo) -> anyhow::Result<FileTree> {
        let backend = &*self.backend;
        let root = Path::new(&info.root);
        Ok(match folder::folder_kind(backend, root)? {
            FolderKind::Repository => folder::load_file_tree(backend, info)?,
            FolderKind::Plain => folder::load_folder_tree(backend, root),
        })
    }

    pub(super) fn file_tree(&self, info: &RepositoryInfo) -> anyhow::Result<Arc<FileTree>> {
        let root = info.root.as_str();
        let cached = || lock(&self.trees).get(root).and_then(|c| c.tree.clone());
        if let Some(tree) = cached() {
            return Ok(tree);
        }
        self.tree_reads.run(root, || {
            // the read this one waited for may have left a tree
            if let Some(tree) = cached() {
                return Ok(tree);
            }
            let before = lock(&self.trees)
                .entry(root.to_string())
                .or_default()
                .changes;
            let tree = Arc::new(self.read_tree(info)?);
            let mut trees = lock(&self.trees);
            let entry = trees.entry(root.to_string()).or_default();
            if entry.changes == before {
                entry.tree = Some(tree.clone());
            }
            Ok(tree)
        })
    }

    /// What a folder of a project's tree holds: from the tree, or from disk for an ignored one,
    /// whose changes then show while the tree lasts.
    pub(super) fn tree_directory(
        &self,
        info: &RepositoryInfo,
        path: &str,
    ) -> anyhow::Result<Directory> {
        let tree = self.file_tree(info)?;
        if !tree.in_ignored_folder(path) {
            return Ok(tree.directory(path));
        }
        let directory = folder::load_ignored_directory(&*self.backend, info, &tree, path)?;
        let first = lock(&self.trees)
            .entry(info.root.clone())
            .or_default()
            .opened
            .insert(path.to_string());
        if first {
            self.watch_opened(&info.root, path);
        }
        Ok(directory)
    }

    /// Where the system watches one folder at a time, watches the ignored folder at `path` the
    /// Files panel read, if its project is the one watched. Off the caller's thread: the folders
    /// are held while the watcher starts.
    fn watch_opened(&self, root: &str, path: &str) {
        let (root, path) = (root.to_string(), path.to_string());
        self.on_own_thread(
            "watch-opened",
            "an opened folder is not watched",
            move |this| {
                let watched = lock(&this.watched);
                if watched.as_ref().is_none_or(|w| !w.is_of(&root)) {
                    return;
                }
                if let Some(folders) = lock(&this.folders).as_mut() {
                    folders.add_opened(&*this.backend, &[Path::new(&path)]);
                }
            },
        );
    }

    /// The files of a repository may have changed: its tree is read again when next asked for.
    pub(super) fn forget_tree(&self, root: &str) {
        lock(&self.trees)
            .entry(root.to_string())
            .or_default()
            .forget();
    }
}
