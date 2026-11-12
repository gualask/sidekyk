//! What this process answers of each folder (`Repositories`): git's reads and the files' as the
//! modules make them, with the caches around them.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::{LocalRepositories, OnChange, Repositories};
use crate::modules::folder::{
    self, Directory, FileContent, FileStamp, FolderKind, RecentFiles, RepositoryInfo,
};
use crate::modules::preview::{self, MarkdownDocument};
use crate::modules::repository::{
    self, ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles,
    CommitRequest, FileDiffRequest, RecentCommits, RepositorySnapshot, RepositorySummary,
    UnifiedDiff,
};
use crate::modules::search::{self, ContentEnd, ContentFile, FileMatches, ProjectFiles};
use crate::modules::syntax::{self, SyntaxColors, SyntaxRequest};
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::sync::lock;

impl Repositories for LocalRepositories {
    fn resolve(&self, candidate: &Path) -> anyhow::Result<RepositoryInfo> {
        folder::resolve_folder(&*self.backend, candidate)
    }

    fn repositories_inside(&self, folder: &RepositoryInfo) -> anyhow::Result<Vec<RepositoryInfo>> {
        folder::repositories_inside(&*self.backend, Path::new(&folder.root))
    }

    fn folder_kind(&self, info: &RepositoryInfo) -> anyhow::Result<FolderKind> {
        folder::folder_kind(&*self.backend, Path::new(&info.root))
    }

    fn snapshot(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySnapshot> {
        let root = info.root.as_str();
        self.snapshots.run(root, || {
            let snapshot = repository::load_snapshot(&*self.backend, info);
            let mut changed = lock(&self.changed);
            match &snapshot {
                Ok(snapshot) => {
                    changed.insert(root.to_string(), snapshot.files.as_slice().into());
                }
                // a repository moved away has nothing left to search
                Err(_) => {
                    changed.remove(root);
                }
            }
            snapshot
        })
    }

    fn summary(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySummary> {
        self.summaries.run(&info.root, || {
            repository::load_summary(&*self.backend, info)
        })
    }

    fn file_diff(
        &self,
        info: &RepositoryInfo,
        request: &FileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        repository::load_file_diff(&*self.backend, info, request)
    }

    fn changes_ignoring_whitespace(
        &self,
        info: &RepositoryInfo,
    ) -> anyhow::Result<ChangesIgnoringWhitespace> {
        repository::load_changes_ignoring_whitespace(&*self.backend, info)
    }

    fn recent_commits(&self, info: &RepositoryInfo) -> anyhow::Result<RecentCommits> {
        repository::load_recent_commits(&*self.backend, info)
    }

    fn commit_activity(&self, info: &RepositoryInfo, since: i64) -> anyhow::Result<CommitActivity> {
        repository::load_commit_activity(&*self.backend, info, since)
    }

    fn commit_files(
        &self,
        info: &RepositoryInfo,
        commit: &CommitRequest,
    ) -> anyhow::Result<CommitFiles> {
        repository::load_commit_files(&*self.backend, info, commit)
    }

    fn commit_file_diff(
        &self,
        info: &RepositoryInfo,
        request: &CommitFileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        repository::load_commit_file_diff(&*self.backend, info, request)
    }

    fn directory(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Directory> {
        Ok(self.file_tree(info)?.directory(path))
    }

    fn recent_files(&self, info: &RepositoryInfo) -> anyhow::Result<RecentFiles> {
        let tree = self.file_tree(info)?;
        folder::load_recent_files(&*self.backend, info, &tree)
    }

    fn file_content(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileContent> {
        self.tree_holding(info, path)?;
        folder::load_file_content(&*self.backend, info, path)
    }

    fn file_stamp(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileStamp> {
        self.tree_holding(info, path)?;
        folder::load_file_stamp(&*self.backend, info, path)
    }

    fn tree_holds_now(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<bool> {
        Ok(self.read_tree(info)?.contains_file(path))
    }

    fn image(
        &self,
        info: &RepositoryInfo,
        path: &str,
        blob: Option<&str>,
    ) -> anyhow::Result<Vec<u8>> {
        if preview::image_type(path).is_none() {
            return Err(user_facing(UserFacingErrorCode::FileMissing));
        }
        // an object is git's, whether or not its path is in the tree (a deleted file's)
        if let Some(blob) = blob {
            return repository::load_blob_image(&*self.backend, info, blob);
        }
        self.tree_holding(info, path)?;
        folder::load_image(&*self.backend, info, path)
    }

    fn blob_size(&self, info: &RepositoryInfo, blob: &str) -> anyhow::Result<u64> {
        repository::load_blob_size(&*self.backend, info, blob)
    }

    fn markdown_preview(
        &self,
        info: &RepositoryInfo,
        path: &str,
    ) -> anyhow::Result<Option<MarkdownDocument>> {
        let tree = self.tree_holding(info, path)?;
        Ok(
            match folder::load_file_content(&*self.backend, info, path)? {
                FileContent::Text { text, truncated } => Some(preview::parse_markdown(
                    &text,
                    path,
                    &|other| tree.contains_file(other),
                    truncated,
                )),
                FileContent::Binary | FileContent::Link { .. } | FileContent::Folder => None,
            },
        )
    }

    fn syntax_colors(
        &self,
        info: &RepositoryInfo,
        request: &SyntaxRequest,
    ) -> anyhow::Result<SyntaxColors> {
        syntax::load_syntax_colors(&*self.backend, info, &self.colors, request)
    }

    fn search_files(&self, info: &RepositoryInfo, query: &str) -> Option<FileMatches> {
        let tree = self
            .file_tree(info)
            .inspect_err(
                |error| tracing::debug!(error = %format!("{error:#}"), "no files to search"),
            )
            .ok()?;
        let changed = lock(&self.changed)
            .get(&info.root)
            .cloned()
            .unwrap_or_else(|| Arc::from([]));
        Some(search::search_files(query, &ProjectFiles { tree, changed }))
    }

    fn search_contents(
        &self,
        info: &RepositoryInfo,
        query: &str,
        send: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd> {
        self.search_contents_in_turn(self.next_content_search(), info, query, send)
    }

    fn stop_content_search(&self) {
        self.content_runs.fetch_add(1, Ordering::Relaxed);
    }

    fn retain(&self, roots: &[String]) {
        let keep = |root: &str| roots.iter().any(|r| r == root);
        self.snapshots.retain(&keep);
        self.summaries.retain(&keep);
        self.tree_reads.retain(&keep);
        lock(&self.changed).retain(|root, _| keep(root));
        // a project gone takes its files with it
        lock(&self.trees).retain(|root, _| keep(root));
        let mut contents = lock(&self.contents);
        if contents.as_ref().is_some_and(|last| !keep(&last.root)) {
            *contents = None;
        }
    }

    fn watch(&self, repository: Option<&RepositoryInfo>, on_change: OnChange) {
        self.watch_in_turn(self.next_watch(), repository, on_change);
    }

    fn set_visible(&self, visible: bool) -> Option<String> {
        self.record_visible(visible)
    }
}
