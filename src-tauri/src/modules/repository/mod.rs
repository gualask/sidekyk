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

pub(crate) use commits::{load_commit_file_diff, load_commit_files, load_recent_commits};
pub(crate) use contracts::{
    ChangeArea, ChangedFile, CommitFileDiffRequest, CommitFiles, CommitRequest, FileDiffRequest,
    RecentCommits, RepositoryChangedEvent, RepositoryInfo, RepositorySnapshot, RepositorySummary,
    UnifiedDiff, REPOSITORY_CHANGED_EVENT,
};
#[cfg(test)]
pub(crate) use contracts::{ChangeKind, Commit};
pub(crate) use diff::load_file_diff;
pub(crate) use ignored::IgnoredPaths;
pub(crate) use open::{repository_name, resolve_repository};
pub(crate) use ports::{GitOutput, RepositoryBackend};
pub(crate) use snapshot::{load_snapshot, load_summary};
