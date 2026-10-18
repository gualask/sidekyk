//! The repository on screen, watched: what each batch of its watcher means for the caches and the
//! app, and what is kept while nobody looks.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use super::LocalRepositories;
use crate::modules::repository::{
    classify, resolve_repository, IgnoredPaths, RepositoryChangedEvent, RepositoryInfo, Visible,
    Watch,
};
use crate::shared::sync::lock;

pub(super) struct Watched {
    root: String,
    /// `None` when the watcher could not start, such as a repository moved away.
    _watch: Option<Watch>,
}

/// While the window is minimized, hidden or covered, as the app tells, the watcher keeps watching
/// but reports nothing, and only marks what it saw.
#[derive(Default)]
pub(super) struct Visibility {
    hidden: bool,
    /// The repository on screen, when its watcher saw a change that may show while hidden.
    missed: Option<String>,
}

impl LocalRepositories {
    /// `Repositories::watch`.
    pub(super) fn watch_on_screen(
        &self,
        repository: Option<&RepositoryInfo>,
        on_change: Box<dyn Fn(RepositoryChangedEvent) + Send + Sync>,
    ) {
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
        // a repository put on screen is read in full anyway
        lock(&self.visibility).missed = None;
        // what the previous watcher saw is gone with it: every tree is read again when asked for,
        // and one read meanwhile is not kept
        for cached in lock(&self.trees).values_mut() {
            cached.tree = None;
            cached.changes += 1;
        }
        let watch = match self.start_watch(root, generation, on_change) {
            Ok(watch) => {
                tracing::info!(root, "project opened");
                Some(watch)
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
        tracing::debug!(visible, missed = missed.is_some(), "window visibility");
        missed
    }

    fn start_watch(
        &self,
        root: &str,
        generation: u64,
        on_change: Box<dyn Fn(RepositoryChangedEvent) + Send + Sync>,
    ) -> anyhow::Result<Watch> {
        let resolved = resolve_repository(&*self.backend, Path::new(root))?;
        let root = resolved.info.root;
        let git_dir = resolved.git_dir;
        let mut ignored = IgnoredPaths::new(root.clone().into());
        // the watch is kept in `self`: a strong reference here would keep both alive
        let repositories = self.this.clone();
        let (watched_root, watched_git_dir) = (root.clone(), git_dir.clone());
        let on_paths = move |paths: Vec<PathBuf>| {
            if let Some(repositories) = repositories.upgrade() {
                repositories.batch(
                    generation,
                    &watched_root,
                    &watched_git_dir,
                    &mut ignored,
                    &paths,
                    &on_change,
                );
            }
        };
        self.watcher
            .watch(Path::new(&root), &git_dir, Box::new(on_paths))
    }

    /// One batch of the watcher, on its thread; dropped once another repository is put on screen.
    fn batch(
        &self,
        generation: u64,
        root: &str,
        git_dir: &Path,
        ignored: &mut IgnoredPaths,
        paths: &[PathBuf],
        on_change: &dyn Fn(RepositoryChangedEvent),
    ) {
        let changes = classify(paths.iter().map(PathBuf::as_path), Path::new(root), git_dir);
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
        let visible = changes.git_dir || worktree.any();
        let files = self.batch_changes_tree(root, changes.git_dir, &worktree);
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
            on_change(RepositoryChangedEvent::new(root, changes.git_dir));
        }
    }

    /// Whether a batch of the watcher may have added or removed a file of the tree read.
    fn batch_changes_tree(&self, root: &str, git_dir: bool, visible: &Visible) -> bool {
        let trees = lock(&self.trees);
        let Some(tree) = trees.get(root).and_then(|c| c.tree.as_ref()) else {
            // nothing read, nothing to read again
            return false;
        };
        git_dir
            || match visible {
                Visible::Unknown => true,
                Visible::Paths(paths) => {
                    tree.may_have_changed(&*self.backend, Path::new(root), paths)
                }
            }
    }
}
