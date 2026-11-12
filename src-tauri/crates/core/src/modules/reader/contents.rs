//! Searches in contents, one going on at a time: the last complete one kept, for the next to read
//! only the files it found when the text grew.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::{ContentRun, LocalRepositories};
use crate::modules::folder::{FileTree, RepositoryInfo};
use crate::modules::search::{self, ContentEnd, ContentFile, ContentSearch};
use crate::shared::sync::lock;

/// A complete search in contents: in which tree, for what, and the files where it found it.
pub(super) struct LastContents {
    pub(super) root: String,
    tree: Arc<FileTree>,
    query: String,
    files: Arc<[String]>,
}

impl LocalRepositories {
    /// Takes the next search in contents' turn, which stops the one going on: in the order
    /// searches were asked for, before any of them starts.
    pub fn next_content_search(&self) -> ContentRun {
        ContentRun(self.content_runs.fetch_add(1, Ordering::Relaxed) + 1)
    }

    /// Runs the search in contents that took `run`, as `Repositories::search_contents`.
    pub fn search_contents_in_turn(
        &self,
        run: ContentRun,
        info: &RepositoryInfo,
        query: &str,
        send: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd> {
        let cancelled = || self.content_runs.load(Ordering::Relaxed) != run.0;
        let root = info.root.as_str();
        let tree = self.file_tree(info)?;
        let narrowed = self.narrowed_files(root, &tree, query);
        let files: Vec<&str> = match &narrowed {
            Some(files) => files.iter().map(String::as_str).collect(),
            None => tree.files().iter().map(String::as_str).collect(),
        };
        let searched = search::search_contents(
            &ContentSearch {
                backend: &*self.backend,
                root: Path::new(root),
                files: &files,
                query,
            },
            &cancelled,
            send,
        );
        let cancelled = cancelled();
        if !cancelled && !searched.cut {
            *lock(&self.contents) = Some(LastContents {
                root: root.to_string(),
                tree,
                query: query.to_string(),
                files: searched.files.into(),
            });
        }
        Ok(ContentEnd {
            more: searched.cut,
            cancelled,
        })
    }

    /// The files the last complete search found, when `query` in the same tree narrows it.
    fn narrowed_files(
        &self,
        root: &str,
        tree: &Arc<FileTree>,
        query: &str,
    ) -> Option<Arc<[String]>> {
        lock(&self.contents)
            .as_ref()
            .filter(|last| {
                last.root == root
                    && Arc::ptr_eq(&last.tree, tree)
                    && search::narrows(&last.query, query)
            })
            .map(|last| last.files.clone())
    }

    /// A file may have changed: a search in contents reads every file again.
    pub(super) fn forget_contents(&self) {
        lock(&self.contents).take();
    }
}
