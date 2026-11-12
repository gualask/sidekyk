//! While the window is hidden, the watcher of the folder on screen reports nothing and only marks
//! what it saw, for when the window shows.

use std::path::PathBuf;

use super::LocalRepositories;
use crate::modules::folder::WatchedChanges;
use crate::shared::sync::lock;

/// More paths than this changed while hidden: every folder is looked at again when the window
/// shows, rather than each path kept.
const MAX_MISSED_PATHS: usize = 1_000;

/// While the window is minimized, hidden or covered, as the app tells, the watcher keeps watching
/// but reports nothing, and only marks what it saw.
#[derive(Default)]
pub(super) struct Visibility {
    pub(super) hidden: bool,
    /// The folder on screen, when its watcher saw a change that may show while hidden.
    pub(super) missed: Option<String>,
    /// Where each folder is watched on its own (inotify), what changed while hidden: the folders
    /// it created are watched when the window shows, since no git runs before. `None` elsewhere.
    pub(super) missed_paths: Option<MissedPaths>,
}

impl Visibility {
    /// A batch of the folder at `root` that may show, seen while hidden.
    pub(super) fn mark_missed(&mut self, root: &str, changes: &WatchedChanges) {
        self.missed = Some(root.to_string());
        if let Some(paths) = self.missed_paths.as_mut() {
            paths.keep(changes);
        }
    }
}

pub(super) enum MissedPaths {
    Paths(Vec<PathBuf>),
    /// Too many to keep, or events dropped: every folder is looked at again.
    TooMany,
}

impl MissedPaths {
    pub(super) const NONE: Self = Self::Paths(Vec::new());

    fn keep(&mut self, changes: &WatchedChanges) {
        let paths = &changes.worktree;
        match self {
            Self::Paths(kept) if !changes.lost && kept.len() + paths.len() <= MAX_MISSED_PATHS => {
                kept.extend_from_slice(paths);
            }
            Self::Paths(_) => *self = Self::TooMany,
            Self::TooMany => {}
        }
    }

    fn is_empty(&self) -> bool {
        matches!(self, Self::Paths(paths) if paths.is_empty())
    }
}

impl LocalRepositories {
    /// `Repositories::set_visible`.
    pub(super) fn record_visible(&self, visible: bool) -> Option<String> {
        let mut visibility = lock(&self.visibility);
        visibility.hidden = !visible;
        let missed = if visible {
            visibility.missed.take()
        } else {
            None
        };
        let to_watch = visibility
            .missed_paths
            .as_mut()
            .filter(|paths| visible && !paths.is_empty());
        if let Some(paths) = to_watch {
            self.watch_missed_folders(std::mem::replace(paths, MissedPaths::NONE));
        }
        tracing::debug!(visible, missed = missed.is_some(), "window visibility");
        missed
    }

    /// Watches the folders created while hidden, off the caller's thread: the app reports the
    /// window showing on its main thread, and the folders wait for the watcher to start.
    fn watch_missed_folders(&self, missed: MissedPaths) {
        let repositories = self.this.clone();
        let spawned = std::thread::Builder::new()
            .name("missed-folders".to_string())
            .spawn(move || {
                let Some(repositories) = repositories.upgrade() else {
                    return;
                };
                let backend = &*repositories.backend;
                let mut folders = lock(&repositories.folders);
                let Some(folders) = folders.as_mut() else {
                    return;
                };
                match missed {
                    MissedPaths::Paths(paths) => folders.add_missed(backend, &paths),
                    MissedPaths::TooMany => folders.rescan(backend),
                }
            });
        if let Err(error) = spawned {
            tracing::warn!(%error, "the folders created while hidden are not watched");
        }
    }
}
