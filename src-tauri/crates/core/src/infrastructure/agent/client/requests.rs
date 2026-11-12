//! `Repositories` through the helper: each call a request to it, answered as `LocalRepositories`
//! answers it on the helper's side (`client` runs the helper).

use std::path::Path;

use super::super::protocol::Request;
use super::{nothing, AgentRepositories};
use crate::modules::folder::{
    Directory, FileContent, FileStamp, FolderKind, RecentFiles, RepositoryInfo,
};
use crate::modules::preview::MarkdownDocument;
use crate::modules::reader::{OnChange, Repositories};
use crate::modules::repository::{
    ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest,
    FileDiffRequest, RecentCommits, RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
use crate::modules::search::{ContentEnd, ContentFile, FileMatches};
use crate::modules::syntax::{SyntaxColors, SyntaxRequest};

impl Repositories for AgentRepositories {
    fn resolve(&self, candidate: &Path) -> anyhow::Result<RepositoryInfo> {
        let candidate = candidate.to_path_buf();
        self.call(Request::Resolve { candidate }, &nothing)
    }

    fn repositories_inside(&self, folder: &RepositoryInfo) -> anyhow::Result<Vec<RepositoryInfo>> {
        let folder = folder.clone();
        self.call(Request::RepositoriesInside { folder }, &nothing)
    }

    fn folder_kind(&self, info: &RepositoryInfo) -> anyhow::Result<FolderKind> {
        let repository = info.clone();
        self.call(Request::FolderKind { repository }, &nothing)
    }

    fn snapshot(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySnapshot> {
        let repository = info.clone();
        self.call(Request::Snapshot { repository }, &nothing)
    }

    fn summary(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySummary> {
        let repository = info.clone();
        self.call(Request::Summary { repository }, &nothing)
    }

    fn file_diff(
        &self,
        info: &RepositoryInfo,
        request: &FileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        let (repository, request) = (info.clone(), request.clone());
        self.call(
            Request::FileDiff {
                repository,
                request,
            },
            &nothing,
        )
    }

    fn changes_ignoring_whitespace(
        &self,
        info: &RepositoryInfo,
    ) -> anyhow::Result<ChangesIgnoringWhitespace> {
        let repository = info.clone();
        self.call(Request::ChangesIgnoringWhitespace { repository }, &nothing)
    }

    fn recent_commits(&self, info: &RepositoryInfo) -> anyhow::Result<RecentCommits> {
        let repository = info.clone();
        self.call(Request::RecentCommits { repository }, &nothing)
    }

    fn commit_activity(&self, info: &RepositoryInfo, since: i64) -> anyhow::Result<CommitActivity> {
        let repository = info.clone();
        self.call(Request::CommitActivity { repository, since }, &nothing)
    }

    fn commit_files(
        &self,
        info: &RepositoryInfo,
        commit: &CommitRequest,
    ) -> anyhow::Result<CommitFiles> {
        let (repository, commit) = (info.clone(), commit.clone());
        self.call(Request::CommitFiles { repository, commit }, &nothing)
    }

    fn commit_file_diff(
        &self,
        info: &RepositoryInfo,
        request: &CommitFileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        let (repository, request) = (info.clone(), request.clone());
        self.call(
            Request::CommitFileDiff {
                repository,
                request,
            },
            &nothing,
        )
    }

    fn directory(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Directory> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::Directory { repository, path }, &nothing)
    }

    fn recent_files(&self, info: &RepositoryInfo) -> anyhow::Result<RecentFiles> {
        let repository = info.clone();
        self.call(Request::RecentFiles { repository }, &nothing)
    }

    fn file_content(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileContent> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::FileContent { repository, path }, &nothing)
    }

    fn file_stamp(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileStamp> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::FileStamp { repository, path }, &nothing)
    }

    fn tree_holds_now(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<bool> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::TreeHoldsNow { repository, path }, &nothing)
    }

    fn image(
        &self,
        info: &RepositoryInfo,
        path: &str,
        blob: Option<&str>,
    ) -> anyhow::Result<Vec<u8>> {
        let (repository, path) = (info.clone(), path.to_string());
        let blob = blob.map(str::to_string);
        self.call_bytes(Request::Image {
            repository,
            path,
            blob,
        })
    }

    fn blob_size(&self, info: &RepositoryInfo, blob: &str) -> anyhow::Result<u64> {
        let (repository, blob) = (info.clone(), blob.to_string());
        self.call(Request::BlobSize { repository, blob }, &nothing)
    }

    fn markdown_preview(
        &self,
        info: &RepositoryInfo,
        path: &str,
    ) -> anyhow::Result<Option<MarkdownDocument>> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::MarkdownPreview { repository, path }, &nothing)
    }

    fn syntax_colors(
        &self,
        info: &RepositoryInfo,
        request: &SyntaxRequest,
    ) -> anyhow::Result<SyntaxColors> {
        let (repository, request) = (info.clone(), request.clone());
        self.call(
            Request::SyntaxColors {
                repository,
                request,
            },
            &nothing,
        )
    }

    fn search_files(&self, info: &RepositoryInfo, query: &str) -> Option<FileMatches> {
        let (repository, query) = (info.clone(), query.to_string());
        self.call::<Option<FileMatches>>(Request::SearchFiles { repository, query }, &nothing)
            .inspect_err(
                |error| tracing::debug!(error = %format!("{error:#}"), "no files to search"),
            )
            .ok()
            .flatten()
    }

    fn search_contents(
        &self,
        info: &RepositoryInfo,
        query: &str,
        send: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd> {
        let (repository, query) = (info.clone(), query.to_string());
        self.call(Request::SearchContents { repository, query }, &send)
    }

    fn stop_content_search(&self) {
        self.tell(Request::StopContentSearch);
    }

    fn retain(&self, roots: &[String]) {
        let roots = roots.to_vec();
        self.tell(Request::Retain { roots });
    }

    fn watch(&self, repository: Option<&RepositoryInfo>, on_change: OnChange) {
        self.tell_watch(repository, on_change);
    }

    fn set_visible(&self, visible: bool) -> Option<String> {
        self.tell_visible(visible);
        None
    }
}
