//! The repository on screen, watched: what each batch of its watcher means for the caches and the
//! app, and what is kept while nobody looks.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use super::{LocalRepositories, OnChange};
use crate::modules::repository::{
    classify, resolve_repository, IgnoredPaths, RepositoryChange, RepositoryInfo, Visible, Watch,
    WatchedFolders,
};
use crate::shared::sync::lock;

/// More paths than this in one batch go as "any may have changed": a burst (a checkout, a
/// dependency install) reads what is open again anyway, and the event stays small.
const MAX_CHANGED_PATHS: usize = 100;

/// More paths than this changed while hidden: every folder is looked at again when the window
/// shows, rather than each path kept.
const MAX_MISSED_PATHS: usize = 1_000;

pub(super) struct Watched {
    root: String,
    /// `None` when the watcher could not start, such as a repository moved away.
    _watch: Option<Box<dyn Send>>,
}

/// The repository a watcher watches.
struct Watching {
    /// As the caller names it: what is kept of the repository is by this root.
    root: String,
    /// As git names it, where the watcher's paths are.
    folder: PathBuf,
    git_dir: PathBuf,
}

/// While the window is minimized, hidden or covered, as the app tells, the watcher keeps watching
/// but reports nothing, and only marks what it saw.
#[derive(Default)]
pub(super) struct Visibility {
    hidden: bool,
    /// The repository on screen, when its watcher saw a change that may show while hidden.
    missed: Option<String>,
    /// Where each folder is watched on its own (inotify), what changed while hidden: the folders
    /// it created are watched when the window shows, since no git runs before. `None` elsewhere.
    missed_paths: Option<MissedPaths>,
}

enum MissedPaths {
    Paths(Vec<PathBuf>),
    /// Too many to keep: every folder is looked at again.
    TooMany,
}

impl MissedPaths {
    const NONE: Self = Self::Paths(Vec::new());

    fn keep(&mut self, paths: &[PathBuf]) {
        match self {
            Self::Paths(kept) if kept.len() + paths.len() <= MAX_MISSED_PATHS => {
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
    /// `Repositories::watch`.
    pub(super) fn watch_on_screen(&self, repository: Option<&RepositoryInfo>, on_change: OnChange) {
        let mut watched = lock(&self.watched);
        let Some(repository) = repository else {
            *watched = None;
            return;
        };
        let root = repository.root.as_str();
        if watched.as_ref().is_some_and(|w| w.root == root) {
            return;
        }
        // a batch of the previous watcher still running is dropped from now on
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        // the previous watcher stops before the next one walks its tree
        *watched = None;
        *lock(&self.folders) = None;
        // a repository put on screen is read in full anyway
        let mut visibility = lock(&self.visibility);
        visibility.missed = None;
        visibility.missed_paths = None;
        drop(visibility);
        // what the previous watcher saw is gone with it: every tree is read again when asked for,
        // and one read meanwhile is not kept
        for cached in lock(&self.trees).values_mut() {
            cached.tree = None;
            cached.changes += 1;
        }
        let watch = match self.start_watch(root, generation, on_change) {
            Ok(watch) => {
                tracing::info!(root, "project opened");
                Some(watch.guard)
            }
            Err(error) => {
                tracing::warn!(root, error = %format!("{error:#}"), "could not watch the project");
                None
            }
        };
        *watched = Some(Watched {
            root: root.to_string(),
            _watch: watch,
        });
    }

    /// `Repositories::set_visible`.
    pub(super) fn record_visible(&self, visible: bool) -> Option<String> {
        let mut visibility = lock(&self.visibility);
        visibility.hidden = !visible;
        let missed = if visible {
            visibility.missed.take()
        } else {
            None
        };
        if visible {
            if let Some(paths) = visibility.missed_paths.as_mut() {
                if !paths.is_empty() {
                    self.watch_missed_folders(std::mem::replace(paths, MissedPaths::NONE));
                }
            }
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

    /// Watches the repository at `root`, the root the caller names it by: what is kept of it and
    /// the changes it reports go by that root, the files watched by the folder git names.
    fn start_watch(
        &self,
        root: &str,
        generation: u64,
        on_change: OnChange,
    ) -> anyhow::Result<Watch> {
        let resolved = resolve_repository(&*self.backend, Path::new(root))?;
        let folder = PathBuf::from(resolved.info.root);
        let git_dir = resolved.git_dir;
        let mut ignored = IgnoredPaths::new(folder.clone());
        // the watch is kept in `self`: a strong reference here would keep both alive
        let repositories = self.this.clone();
        let watched = Watching {
            root: root.to_string(),
            folder: folder.clone(),
            git_dir: git_dir.clone(),
        };
        let on_paths = move |paths: Vec<PathBuf>| {
            if let Some(repositories) = repositories.upgrade() {
                repositories.batch(generation, &watched, &mut ignored, &paths, &on_change);
            }
        };
        let watch = self.watcher.watch(&folder, &git_dir, Box::new(on_paths))?;
        lock(&self.visibility).missed_paths = watch.folders.is_some().then_some(MissedPaths::NONE);
        if let Some(watcher) = watch.folders.clone() {
            // held while the folders are walked: a batch meanwhile waits to watch what it created
            let mut folders = lock(&self.folders);
            *folders = Some(WatchedFolders::start(
                &*self.backend,
                watcher,
                &folder,
                &git_dir,
            ));
        }
        Ok(watch)
    }

    /// One batch of the watcher, on its thread; dropped once another repository is put on screen.
    fn batch(
        &self,
        generation: u64,
        watched: &Watching,
        ignored: &mut IgnoredPaths,
        paths: &[PathBuf],
        on_change: &dyn Fn(RepositoryChange),
    ) {
        let root = watched.root.as_str();
        let changes = classify(
            paths.iter().map(PathBuf::as_path),
            &watched.folder,
            &watched.git_dir,
        );
        if changes.is_empty() {
            return;
        }
        // The index may now track a file in an ignored directory, or the excludes changed.
        if changes.git_dir {
            ignored.forget();
        }
        // held until the batch is settled, so the window cannot show in between and miss it
        let mut visibility = lock(&self.visibility);
        // checked under the lock that `watch` takes after counting, so no mark lands after its reset
        if self.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        // nobody looks: no `check-ignore`, no refresh, only a mark for when the window shows
        if visibility.hidden {
            let marked = changes.git_dir || ignored.any_maybe_visible(&changes.worktree);
            if marked {
                visibility.missed = Some(root.to_string());
                if let Some(paths) = visibility.missed_paths.as_mut() {
                    paths.keep(&changes.worktree);
                }
                self.forget_tree(root);
                self.forget_contents();
            }
            tracing::debug!(
                git_dir = changes.git_dir,
                worktree_paths = changes.worktree.len(),
                marked,
                "watcher batch while hidden"
            );
            return;
        }
        drop(visibility);
        let worktree = ignored.visible(&*self.backend, &changes.worktree);
        self.watch_created_folders(&worktree);
        let visible = changes.git_dir || worktree.any();
        let files = self.batch_changes_tree(watched, changes.git_dir, &worktree);
        if files {
            self.forget_tree(root);
        }
        tracing::debug!(
            git_dir = changes.git_dir,
            worktree_paths = changes.worktree.len(),
            visible,
            files,
            "watcher batch"
        );
        if visible {
            self.forget_contents();
            on_change(RepositoryChange {
                root: root.to_string(),
                git_dir: changes.git_dir,
                paths: worktree.git_paths(MAX_CHANGED_PATHS),
            });
        }
    }

    /// Where each folder is watched on its own, watches the folders a batch created, before the
    /// change is told; every folder is looked at again when what git ignores may have changed.
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
