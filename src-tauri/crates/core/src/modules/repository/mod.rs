//! The repository under review: summarizing its working tree, its diffs and commits, over the
//! folder that holds it (`modules/folder`). Everything is read-only. Sidekyk never writes to the
//! index or the working tree.

mod activity;
mod commits;
mod contracts;
mod diff;
mod limits;
mod numstat;
mod snapshot;
mod status;
mod version;
mod whitespace;

pub use activity::load_commit_activity;
pub use commits::{load_commit_file_diff, load_commit_files, load_recent_commits};
pub use contracts::{
    AreaLines, ChangeKind, ChangedFile, ChangesIgnoringWhitespace, CommitActivity,
    CommitFileDiffRequest, CommitFiles, CommitRequest, FileDiffRequest, FileVersion, RecentCommits,
    RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
#[cfg(test)]
pub use contracts::{ChangeArea, Commit};
pub use diff::load_file_diff;
pub use snapshot::{load_snapshot, load_summary};
pub use version::{load_blob_image, load_blob_size, load_version_text, VersionText};
pub use whitespace::load_changes_ignoring_whitespace;
