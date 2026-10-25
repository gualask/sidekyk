//! The repository under review: opening it, summarizing its working tree, and producing file
//! diffs. Everything is read-only. Sidekyk never writes to the index or the working tree.

mod activity;
mod commits;
mod contracts;
mod diff;
mod folders;
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

pub use activity::load_commit_activity;
pub use commits::{load_commit_file_diff, load_commit_files, load_recent_commits};
#[cfg(test)]
pub use contracts::{ChangeArea, Commit};
pub use contracts::{
    ChangeKind, ChangedFile, CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest,
    Directory, FileContent, FileDiffRequest, FileStamp, FileVersion, RecentCommits,
    RepositoryChange, RepositoryChangedEvent, RepositoryInfo, RepositorySnapshot,
    RepositorySummary, UnifiedDiff, REPOSITORY_CHANGED_EVENT,
};
pub use diff::load_file_diff;
pub use folders::{Hiding, WatchedFolders};
pub use ignored::{IgnoredPaths, Visible};
pub use limits::{MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_TREE_PATHS};
pub use open::{existing_folder, repository_name, resolve_repository};
pub use ports::{
    FolderAdded, FolderRules, FolderWatcher, GitOutput, RepositoryBackend, RepositoryWatcher,
    Walked, Watch, WorktreeEntry,
};
pub use snapshot::{load_snapshot, load_summary};
pub use tree::{load_file_content, load_file_stamp, load_file_tree, load_image, FileTree};
pub use version::{load_version_text, VersionText};
pub use watched::classify;
