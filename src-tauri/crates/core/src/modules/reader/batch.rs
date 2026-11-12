//! What each batch of the watcher of the folder on screen means for the caches and the app.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use super::visibility::Visibility;
use super::LocalRepositories;
use crate::modules::folder::{
    classify, folder_kind, Changed, FolderChanges, FolderKind, IgnoredPaths, RepositoryBackend,
    RepositoryChange, Visible, WatchedChanges,
};
use crate::shared::sync::lock;

/// More paths than this in one batch go as "any may have changed": a burst (a checkout, a
/// dependency install) reads what is open again anyway, and the event stays small.
const MAX_CHANGED_PATHS: usize = 100;

/// The folder a watcher watches.
pub(super) struct Watching {
    /// As the caller names it: what is kept of the folder is by this root.
    pub(super) root: String,
    /// As git, or the system for a folder without git, names it: where the watcher's paths are.
    pub(super) folder: PathBuf,
    /// `None` for a folder without git.
    pub(super) git_dir: Option<PathBuf>,
}

impl Watching {
    /// Whether a batch brought or took the `.git` at the root, so the folder is now the other
    /// kind. No git runs.
    fn kind_changed(&self, backend: &dyn RepositoryBackend, changed: &Changed) -> bool {
        let watched_as = if self.git_dir.is_some() {
            FolderKind::Repository
        } else {
            FolderKind::Plain
        };
        let git_touched = match changed {
            Changed::Paths(paths) => paths.contains(&self.folder.join(".git")),
            // the `.git` may have come or gone among the events dropped
            Changed::Unknown => true,
        };
        git_touched && folder_kind(backend, &self.folder).is_ok_and(|kind| kind != watched_as)
    }

    /// What a batch changed, by where it lies in the folder. No git runs.
    fn changes(&self, changed: &Changed) -> WatchedChanges {
        match changed {
            Changed::Paths(paths) => classify(
                paths.iter().map(PathBuf::as_path),
                &self.folder,
                self.git_dir.as_deref(),
            ),
            Changed::Unknown => WatchedChanges::lost(self.git_dir.is_some()),
        }
    }
}

/// Which changes show: git's answer for a repository, the walk's rules for a folder without git.
pub(super) enum Filter {
    Git(IgnoredPaths),
    Rules(FolderChanges),
}

impl Filter {
    fn visible<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        changed: &'a [PathBuf],
    ) -> Visible<'a> {
        match self {
            Self::Git(ignored) => ignored.visible(backend, changed),
            Self::Rules(changes) => changes.visible(backend, changed),
        }
    }

    /// Whether any of these changes may show, while the window is hidden: no git runs.
    fn any_maybe_visible(&mut self, backend: &dyn RepositoryBackend, changed: &[PathBuf]) -> bool {
        match self {
            Self::Git(ignored) => ignored.any_maybe_visible(backend, changed),
            Self::Rules(changes) => changes.visible(backend, changed).any(),
        }
    }

    /// Drops what a batch's changes may have made wrong.
    fn settle(&mut self, backend: &dyn RepositoryBackend, folder: &Path, changes: &WatchedChanges) {
        if changes.lost {
            self.start_over(backend, folder);
        } else if changes.git_dir {
            // The index may now track a file in an ignored directory, or the excludes changed.
            self.forget();
        }
    }

    /// The index or the excludes may have changed what git ignores.
    fn forget(&mut self) {
        if let Self::Git(ignored) = self {
            ignored.forget();
        }
    }

    /// The system dropped events: nothing learned holds, and the rules of a folder without git
    /// are read again.
    fn start_over(&mut self, backend: &dyn RepositoryBackend, folder: &Path) {
        match self {
            Self::Git(ignored) => ignored.forget(),
            Self::Rules(changes) => *changes = FolderChanges::new(backend, folder.to_path_buf()),
        }
    }
}

impl LocalRepositories {
    /// One batch of the watcher, on its thread; dropped once another folder is put on screen.
    pub(super) fn batch(
        &self,
        generation: u64,
        watched: &Watching,
        filter: &mut Filter,
        changed: &Changed,
        on_change: &dyn Fn(RepositoryChange),
    ) {
        if watched.kind_changed(&*self.backend, changed) {
            self.watch_other_kind(generation, &watched.root);
            return;
        }
        let changes = watched.changes(changed);
        if changes.is_empty() {
            return;
        }
        filter.settle(&*self.backend, &watched.folder, &changes);
        // held until the batch is settled, so the window cannot show in between and miss it
        let mut visibility = lock(&self.visibility);
        // checked under the lock that `watch` takes after counting, so no mark lands after its reset
        if self.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        if visibility.hidden {
            self.mark_while_hidden(&mut visibility, &watched.root, filter, &changes);
            return;
        }
        drop(visibility);
        self.tell_batch(watched, filter, &changes, on_change);
    }

    /// Nobody looks: no `check-ignore`, no refresh, only a mark for when the window shows.
    fn mark_while_hidden(
        &self,
        visibility: &mut Visibility,
        root: &str,
        filter: &mut Filter,
        changes: &WatchedChanges,
    ) {
        let marked = changes.git_dir
            || changes.lost
            || filter.any_maybe_visible(&*self.backend, &changes.worktree);
        if marked {
            visibility.mark_missed(root, changes);
            self.forget_tree(root);
            self.forget_contents();
        }
        tracing::debug!(
            git_dir = changes.git_dir,
            worktree_paths = changes.worktree.len(),
            lost = changes.lost,
            marked,
            "watcher batch while hidden"
        );
    }

    /// The window shows: what the batch may have changed is read again when asked for, and a
    /// change that shows is told.
    fn tell_batch(
        &self,
        watched: &Watching,
        filter: &mut Filter,
        changes: &WatchedChanges,
        on_change: &dyn Fn(RepositoryChange),
    ) {
        let root = watched.root.as_str();
        let worktree = if changes.lost {
            Visible::Unknown
        } else {
            filter.visible(&*self.backend, &changes.worktree)
        };
        self.watch_created_folders(&worktree);
        let visible = changes.git_dir || worktree.any();
        let files = self.batch_changes_tree(watched, changes.git_dir, &worktree);
        if files {
            self.forget_tree(root);
        }
        tracing::debug!(
            git_dir = changes.git_dir,
            worktree_paths = changes.worktree.len(),
            lost = changes.lost,
            visible,
            files,
            "watcher batch"
        );
        if !visible {
            return;
        }
        self.forget_contents();
        on_change(RepositoryChange {
            root: root.to_string(),
            git_dir: changes.git_dir,
            paths: worktree.git_paths(MAX_CHANGED_PATHS),
            kind_changed: false,
        });
    }

    /// Where each folder is watched on its own, watches the folders a batch created, before the
    /// change is told; every folder is looked at again when what git ignores may have changed, or
    /// the system dropped events.
    fn watch_created_folders(&self, worktree: &Visible) {
        let mut folders = lock(&self.folders);
        let Some(folders) = folders.as_mut() else {
            return;
        };
        match worktree {
            Visible::Unknown => folders.rescan(&*self.backend),
            Visible::Paths(paths) => folders.add_created(&*self.backend, paths),
        }
    }

    /// Whether a batch of the watcher may have added or removed a file of the tree read.
    fn batch_changes_tree(&self, watched: &Watching, git_dir: bool, visible: &Visible) -> bool {
        let trees = lock(&self.trees);
        let Some(tree) = trees.get(&watched.root).and_then(|c| c.tree.as_ref()) else {
            // nothing read, nothing to read again
            return false;
        };
        git_dir
            || match visible {
                Visible::Unknown => true,
                Visible::Paths(paths) => {
                    tree.may_have_changed(&*self.backend, &watched.folder, paths)
                }
            }
    }
}
