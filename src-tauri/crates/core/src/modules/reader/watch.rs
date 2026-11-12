//! The project's folder on screen, watched: its watcher started, and started again when the folder
//! becomes a repository or stops being one. What a batch means is `batch`'s; what is kept while
//! nobody looks, `visibility`'s.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::batch::{Filter, Watching};
use super::visibility::MissedPaths;
use super::{LocalRepositories, OnChange, WatchTurn};
use crate::modules::folder::{
    folder_kind, resolve_repository, Changed, FolderChanges, FolderKind, FolderWatcher, Hiding,
    IgnoredPaths, RepositoryBackend, RepositoryChange, RepositoryInfo, Watch, WatchedFolders,
};
use crate::shared::sync::lock;

/// What gets each change of the folder watched, kept to watch it again when its kind changes.
type SharedOnChange = Arc<dyn Fn(RepositoryChange) + Send + Sync>;

pub(super) struct Watched {
    root: String,
    on_change: SharedOnChange,
    /// `None` when the watcher could not start, such as a folder moved away.
    _watch: Option<Box<dyn Send>>,
}

impl LocalRepositories {
    /// `Repositories::watch`.
    pub(super) fn watch_on_screen(
        &self,
        turn: WatchTurn,
        repository: Option<&RepositoryInfo>,
        on_change: OnChange,
    ) {
        let mut watched = lock(&self.watched);
        // a watch asked later was done: this one came late
        if turn.0 < self.watch_done.load(Ordering::Relaxed) {
            return;
        }
        self.watch_done.store(turn.0, Ordering::Relaxed);
        let Some(repository) = repository else {
            *watched = None;
            return;
        };
        let root = repository.root.as_str();
        if watched.as_ref().is_some_and(|w| w.root == root) {
            return;
        }
        self.watch_anew(&mut watched, root, Arc::from(on_change));
    }

    /// Watches the folder at `root` in place of what `watched` holds, from scratch.
    fn watch_anew(&self, watched: &mut Option<Watched>, root: &str, on_change: SharedOnChange) {
        // a batch of the previous watcher still running is dropped from now on
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        // the previous watcher stops before the next one walks its tree
        *watched = None;
        *lock(&self.folders) = None;
        self.forget_what_was_seen();
        let watch = match self.start_watch(root, generation, on_change.clone()) {
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
            on_change,
            _watch: watch,
        });
    }

    /// What the previous watcher saw is gone with it.
    fn forget_what_was_seen(&self) {
        // a folder put on screen is read in full anyway
        let mut visibility = lock(&self.visibility);
        visibility.missed = None;
        visibility.missed_paths = None;
        drop(visibility);
        // every tree is read again when asked for, and one read meanwhile is not kept
        for cached in lock(&self.trees).values_mut() {
            cached.tree = None;
            cached.changes += 1;
        }
    }

    /// The folder on screen became a repository, or stopped being one: it is watched again as the
    /// other kind, then the change is told. Off the watcher's thread, which stops with its watch.
    pub(super) fn watch_other_kind(&self, generation: u64, root: &str) {
        let repositories = self.this.clone();
        let root = root.to_string();
        let spawned = std::thread::Builder::new()
            .name("kind-changed".to_string())
            .spawn(move || {
                let Some(repositories) = repositories.upgrade() else {
                    return;
                };
                let mut watched = lock(&repositories.watched);
                // another folder put on screen meanwhile, or a batch before this one saw it
                if repositories.generation.load(Ordering::Relaxed) != generation {
                    return;
                }
                let Some(on_change) = watched.as_ref().map(|w| w.on_change.clone()) else {
                    return;
                };
                repositories.watch_anew(&mut watched, &root, on_change.clone());
                drop(watched);
                tracing::info!(root, "the project's folder changed kind");
                on_change(RepositoryChange::kind(root));
            });
        if let Err(error) = spawned {
            tracing::warn!(%error, "the folder's new kind is not watched");
        }
    }

    /// Watches the folder at `root`, the root the caller names it by: what is kept of it and the
    /// changes it reports go by that root, the files watched by the folder git, or the system for
    /// a folder without git, names.
    fn start_watch(
        &self,
        root: &str,
        generation: u64,
        on_change: SharedOnChange,
    ) -> anyhow::Result<Watch> {
        let (watched, mut filter) = watched_folder(&*self.backend, root)?;
        let (folder, git_dir) = (watched.folder.clone(), watched.git_dir.clone());
        // the watch is kept in `self`: a strong reference here would keep both alive
        let repositories = self.this.clone();
        let on_changed = move |changed: Changed| {
            if let Some(repositories) = repositories.upgrade() {
                repositories.batch(generation, &watched, &mut filter, &changed, &*on_change);
            }
        };
        let watch = self
            .watcher
            .watch(&folder, git_dir.as_deref(), Box::new(on_changed))?;
        lock(&self.visibility).missed_paths = watch.folders.is_some().then_some(MissedPaths::NONE);
        if let Some(watcher) = watch.folders.clone() {
            self.watch_each_folder(watcher, &folder, git_dir);
        }
        Ok(watch)
    }

    /// Where the system watches one folder at a time, walks the folder to watch each one that
    /// shows.
    fn watch_each_folder(
        &self,
        watcher: Arc<dyn FolderWatcher>,
        folder: &Path,
        git_dir: Option<PathBuf>,
    ) {
        let backend = &*self.backend;
        let hiding = match git_dir {
            Some(git_dir) => Hiding::Git { git_dir },
            None => Hiding::Rules(backend.folder_rules(folder)),
        };
        // held while the folders are walked: a batch meanwhile waits to watch what it created
        let mut folders = lock(&self.folders);
        *folders = Some(WatchedFolders::start(backend, watcher, folder, hiding));
    }
}

/// The folder at `root` as git, or the system for a folder without git, names it, and which of
/// its changes show.
fn watched_folder(
    backend: &dyn RepositoryBackend,
    root: &str,
) -> anyhow::Result<(Watching, Filter)> {
    let (folder, git_dir, filter) = match folder_kind(backend, Path::new(root))? {
        FolderKind::Repository => {
            let resolved = resolve_repository(backend, Path::new(root))?;
            let folder = PathBuf::from(resolved.info.root);
            let filter = Filter::Git(IgnoredPaths::new(folder.clone()));
            (folder, Some(resolved.git_dir), filter)
        }
        FolderKind::Plain => {
            let folder = backend
                .real_path(Path::new(root))
                .unwrap_or_else(|| PathBuf::from(root));
            let filter = Filter::Rules(FolderChanges::new(backend, folder.clone()));
            (folder, None, filter)
        }
    };
    let watched = Watching {
        root: root.to_string(),
        folder,
        git_dir,
    };
    Ok((watched, filter))
}
