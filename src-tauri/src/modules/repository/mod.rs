//! The repository under review: opening it, summarizing its working tree, and producing file
//! diffs. Everything is read-only. Sidekyk never writes to the index or the working tree.

mod commits;
mod contracts;
mod diff;
mod ignored;
mod limits;
mod numstat;
mod open;
mod ports;
mod snapshot;
mod status;
mod tree;

pub(crate) use commits::{load_commit_file_diff, load_commit_files, load_recent_commits};
#[cfg(test)]
pub(crate) use contracts::{ChangeArea, Commit};
pub(crate) use contracts::{
    ChangeKind, ChangedFile, CommitFileDiffRequest, CommitFiles, CommitRequest, Directory,
    FileContent, FileDiffRequest, RecentCommits, RepositoryChangedEvent, RepositoryInfo,
    RepositorySnapshot, RepositorySummary, UnifiedDiff, REPOSITORY_CHANGED_EVENT,
};
pub(crate) use diff::load_file_diff;
pub(crate) use ignored::{IgnoredPaths, Visible};
pub(crate) use limits::MAX_FILE_BYTES;
pub(crate) use open::{repository_name, resolve_repository};
pub(crate) use ports::{GitOutput, RepositoryBackend, WorktreeEntry};
pub(crate) use snapshot::{load_snapshot, load_summary};
pub(crate) use tree::{load_file_content, load_file_tree, FileTree};
