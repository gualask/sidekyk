//! What the app reads its repositories through: this machine's (`LocalRepositories`) or a
//! helper's, on another machine (`infrastructure::agent`). Every method maps onto one request.

use std::path::Path;

use crate::modules::repository::{
    CommitFileDiffRequest, CommitFiles, CommitRequest, Directory, FileContent, FileDiffRequest,
    RecentCommits, RepositoryChange, RepositoryInfo, RepositorySnapshot, RepositorySummary,
    UnifiedDiff,
};
use crate::modules::search::{ContentEnd, ContentFile, FileMatches};
use crate::modules::syntax::{SyntaxColors, SyntaxRequest};

/// A search in contents' turn: a newer one stops it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentRun(pub(super) u64);

pub trait Repositories: Send + Sync {
    /// The repository that contains `candidate`, which can be any folder inside it.
    fn resolve(&self, candidate: &Path) -> anyhow::Result<RepositoryInfo>;

    /// A repository's snapshot, sharing the one in flight.
    fn snapshot(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySnapshot>;

    /// A repository's summary, sharing the one in flight.
    fn summary(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySummary>;

    fn file_diff(
        &self,
        info: &RepositoryInfo,
        request: &FileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff>;

    fn recent_commits(&self, info: &RepositoryInfo) -> anyhow::Result<RecentCommits>;

    fn commit_files(
        &self,
        info: &RepositoryInfo,
        commit: &CommitRequest,
    ) -> anyhow::Result<CommitFiles>;

    fn commit_file_diff(
        &self,
        info: &RepositoryInfo,
        request: &CommitFileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff>;

    /// What a folder of a repository holds, from its files in memory; `""` is the root.
    fn directory(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Directory>;

    /// One file of a repository's tree. Only a file of the tree is read, so never one git ignores.
    fn file_content(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileContent>;

    /// The syntax colors of some lines of one version of a file.
    fn syntax_colors(
        &self,
        info: &RepositoryInfo,
        request: &SyntaxRequest,
    ) -> anyhow::Result<SyntaxColors>;

    /// The palette's matches among a repository's files: its tree (read if not yet), and how its
    /// last snapshot found them changed; none when they cannot be listed.
    fn search_files(&self, info: &RepositoryInfo, query: &str) -> Option<FileMatches>;

    /// The lines of a repository's files where `query` is, sent to `send` as they are found. A
    /// newer search, or `stop_content_search`, stops this one. When the text grew from the last
    /// complete search's, in the same files and with nothing changed since, only the files it
    /// found are read.
    fn search_contents(
        &self,
        info: &RepositoryInfo,
        query: &str,
        send: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd>;

    /// Stops the search in contents going on, if any: the palette closed. Does not wait.
    fn stop_content_search(&self);

    /// Forgets every repository but `roots`, the ones the caller still reads.
    fn retain(&self, roots: &[String]);

    /// Watches the repository on screen, unless it is the one watched already, and stops watching
    /// the previous one; `None` watches nothing. `on_change` gets each change that shows; for the
    /// repository watched already, the first `on_change` stays. The caller calls it in the order
    /// the repository on screen changed.
    fn watch(
        &self,
        repository: Option<&RepositoryInfo>,
        on_change: Box<dyn Fn(RepositoryChange) + Send + Sync>,
    );

    /// Records whether the window shows. A change of the repository on screen seen meanwhile is
    /// told when it shows again: returned, or sent to `watch`'s `on_change` by an implementation
    /// that does not wait (the helper's).
    fn set_visible(&self, visible: bool) -> Option<String>;
}
