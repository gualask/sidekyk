//! The repository under review: opening it, summarizing its working tree, and producing file
//! diffs. Everything is read-only. Sidekyk never writes to the index or the working tree.

mod contracts;
mod diff;
mod ignored;
mod numstat;
mod open;
mod ports;
mod snapshot;
mod status;

pub(crate) use contracts::{
    FileDiff, FileDiffRequest, RepositoryChangedEvent, RepositoryInfo, RepositorySnapshot,
    REPOSITORY_CHANGED_EVENT,
};
pub(crate) use diff::load_file_diff;
pub(crate) use ignored::IgnoredPaths;
pub(crate) use open::resolve_repository;
pub(crate) use ports::{GitOutput, RepositoryBackend};
pub(crate) use snapshot::load_snapshot;
