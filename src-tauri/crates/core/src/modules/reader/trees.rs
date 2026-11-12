//! The files of each project, as the Files panel shows them: read when first asked for, kept
//! until they may have changed, the read in flight shared.

use std::path::Path;
use std::sync::Arc;

use super::LocalRepositories;
use crate::modules::folder::{self, FileTree, FolderKind, RepositoryInfo};
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::sync::lock;

/// A project's files, as the Files panel shows them.
#[derive(Default)]
pub(super) struct CachedTree {
    pub(super) tree: Option<Arc<FileTree>>,
    /// Counts the times the files may have changed, so a tree read meanwhile is not kept.
    pub(super) changes: u64,
}

impl LocalRepositories {
    /// A project's files, read again only when they may have changed, sharing the read in flight:
    /// those git lists in a repository, those the walk lists in a folder without git.
    /// The project's tree when `path` is one of its files, else `file_missing`: only a file of the
    /// tree is read, so never one hidden.
    pub(super) fn tree_holding(
        &self,
        info: &RepositoryInfo,
        path: &str,
    ) -> anyhow::Result<Arc<FileTree>> {
        let tree = self.file_tree(info)?;
        if tree.contains_file(path) {
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

    /// The files of a repository may have changed: its tree is read again when next asked for.
    pub(super) fn forget_tree(&self, root: &str) {
        let mut trees = lock(&self.trees);
        let entry = trees.entry(root.to_string()).or_default();
        entry.tree = None;
        entry.changes += 1;
    }
}
