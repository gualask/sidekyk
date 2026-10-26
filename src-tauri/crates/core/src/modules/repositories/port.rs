//! What the app reads its repositories through: this machine's (`LocalRepositories`) or a
//! helper's, on another machine (`infrastructure::agent`). Every method maps onto one request.

use std::path::Path;

use crate::modules::folder::FolderKind;
use crate::modules::preview::MarkdownDocument;
use crate::modules::repository::{
    ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest,
    Directory, FileContent, FileDiffRequest, FileStamp, RecentCommits, RepositoryChange,
    RepositoryInfo, RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
use crate::modules::search::{ContentEnd, ContentFile, FileMatches};
use crate::modules::syntax::{SyntaxColors, SyntaxRequest};

/// What gets each change of the repository watched that shows.
pub type OnChange = Box<dyn Fn(RepositoryChange) + Send + Sync>;

/// A search in contents' turn: a newer one stops it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentRun(pub(super) u64);

pub trait Repositories: Send + Sync {
    /// The folder a project takes for `candidate`: the repository that holds it, else itself
    /// (`folder::resolve_folder`).
    fn resolve(&self, candidate: &Path) -> anyhow::Result<RepositoryInfo>;

    /// Whether a project's folder is a repository or a folder without git, without git.
    fn folder_kind(&self, info: &RepositoryInfo) -> anyhow::Result<FolderKind>;

    /// A repository's snapshot, sharing the one in flight.
    fn snapshot(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySnapshot>;

    /// A repository's summary, sharing the one in flight.
    fn summary(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySummary>;

    fn file_diff(
        &self,
        info: &RepositoryInfo,
        request: &FileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff>;

    /// The staged and unstaged changes with whitespace ignored, read only when asked.
    fn changes_ignoring_whitespace(
        &self,
        info: &RepositoryInfo,
    ) -> anyhow::Result<ChangesIgnoringWhitespace>;

    fn recent_commits(&self, info: &RepositoryInfo) -> anyhow::Result<RecentCommits>;

    fn commit_activity(&self, info: &RepositoryInfo, since: i64) -> anyhow::Result<CommitActivity>;

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

    /// What a folder of a project's folder holds, from its files in memory; `""` is the root.
    fn directory(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Directory>;

    /// One file of a project's tree. Only a file of the tree is read, so never one hidden.
    fn file_content(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileContent>;

    /// The size and last change of a file of a project's tree.
    fn file_stamp(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileStamp>;

    /// An image of a project's tree, its bytes whole (at most `MAX_IMAGE_BYTES`), for the viewer
    /// and the Markdown preview to show.
    fn image(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Vec<u8>>;

    /// A Markdown file of a project's tree as its preview's tree, its links and images resolved
    /// against the tree; none when it is not text (binary, a link, a submodule).
    fn markdown_preview(
        &self,
        info: &RepositoryInfo,
        path: &str,
    ) -> anyhow::Result<Option<MarkdownDocument>>;

    /// The syntax colors of some lines of one version of a file.
    fn syntax_colors(
        &self,
        info: &RepositoryInfo,
        request: &SyntaxRequest,
    ) -> anyhow::Result<SyntaxColors>;

    /// The palette's matches among a project's files: its tree (read if not yet), and how its last
    /// snapshot found them changed; none when they cannot be listed.
    fn search_files(&self, info: &RepositoryInfo, query: &str) -> Option<FileMatches>;

    /// The lines of a project's files where `query` is, sent to `send` as they are found. A
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

    /// Watches the project's folder on screen, unless it is the one watched already, and stops
    /// watching the previous one; `None` watches nothing. `on_change` gets each change that
    /// shows, a change of kind included; for the folder watched already, the first `on_change`
    /// stays. The caller calls it in the order
    /// the repository on screen changed.
    fn watch(&self, repository: Option<&RepositoryInfo>, on_change: OnChange);

    /// Records whether the window shows. A change of the repository on screen seen meanwhile is
    /// told when it shows again: returned, or sent to `watch`'s `on_change` by an implementation
    /// that does not wait (the helper's).
    fn set_visible(&self, visible: bool) -> Option<String>;
}
