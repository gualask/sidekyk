//! The repository under review: summarizing its working tree, its diffs and commits, over the
//! folder that holds it (`modules/folder`). Everything is read-only but the branch switch the user
//! asks for (`branches`): Sidekyk never stages, commits or edits the working tree.

mod activity;
mod branches;
mod commits;
mod contracts;
mod diff;
mod diff_counts;
mod limits;
mod numstat;
mod snapshot;
mod status;
mod version;
mod whitespace;

pub use activity::load_commit_activity;
pub use branches::{load_branches, switch_branch};
pub use commits::{load_commit_file_diff, load_commit_files, load_recent_commits};
pub use contracts::{
    AreaLines, Branch, BranchSwitch, ChangeKind, ChangedFile, ChangesIgnoringWhitespace,
    CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest, FileDiffRequest,
    FileVersion, RecentCommits, RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
#[cfg(test)]
pub use contracts::{ChangeArea, Commit, CommitRef, CommitRefKind};
pub use diff::load_file_diff;
pub use snapshot::{load_snapshot, load_summary};
pub use version::{load_blob_image, load_blob_size, load_version_text, VersionText};
pub use whitespace::load_changes_ignoring_whitespace;
