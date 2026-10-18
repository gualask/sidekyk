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
mod version;
mod watched;

pub use commits::{load_commit_file_diff, load_commit_files, load_recent_commits};
#[cfg(test)]
pub use contracts::{ChangeArea, Commit};
pub use contracts::{
    ChangeKind, ChangedFile, CommitFileDiffRequest, CommitFiles, CommitRequest, Directory,
    FileContent, FileDiffRequest, FileVersion, RecentCommits, RepositoryChangedEvent,
    RepositoryInfo, RepositorySnapshot, RepositorySummary, UnifiedDiff, REPOSITORY_CHANGED_EVENT,
};
pub use diff::load_file_diff;
pub use ignored::{IgnoredPaths, Visible};
pub use limits::MAX_FILE_BYTES;
pub use open::{repository_name, resolve_repository};
pub use ports::{GitOutput, RepositoryBackend, RepositoryWatcher, Watch, WorktreeEntry};
pub use snapshot::{load_snapshot, load_summary};
pub use tree::{load_file_content, load_file_tree, FileTree};
pub use version::{load_version_text, VersionText};
pub use watched::classify;
