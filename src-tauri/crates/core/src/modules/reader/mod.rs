//! The folders this process reads, repositories or not, as the app shows them: each one's reads
//! shared while in flight, its files kept until they may have changed, the one on screen watched.
//! The app runs it for its local projects; the helper runs it inside a WSL distro, answering over
//! a pipe (`docs/features/wsl.md`). The caller checks that a repository is one the user added
//! before naming it.

mod batch;
mod contents;
mod per_repository;
mod port;
mod repositories;
mod trees;
mod visibility;
mod watch;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};

use crate::modules::folder::{
    FileTree, RepositoryBackend, RepositoryInfo, RepositoryWatcher, WatchedFolders,
};
use crate::modules::repository::{ChangedFile, RepositorySnapshot, RepositorySummary};
use crate::modules::syntax::ColorCache;

use contents::LastContents;
use per_repository::PerRepository;
pub use port::{ContentRun, OnChange, Repositories, WatchTurn};
use trees::CachedTree;
use visibility::Visibility;
use watch::Watched;

pub struct LocalRepositories {
    /// Itself, for the watcher it starts to reach back without keeping it alive.
    this: Weak<Self>,
    backend: Arc<dyn RepositoryBackend>,
    watcher: Arc<dyn RepositoryWatcher>,
    colors: ColorCache,
    /// Only the repository on screen is watched. Kept apart from the rest, since starting a
    /// watcher can take a while (on Linux it walks the tree) and must not hold up reads.
    watched: Mutex<Option<Watched>>,
    /// Counts the repositories put on screen: a batch of a watcher replaced since is dropped.
    generation: AtomicU64,
    /// Counts the watches asked for (`next_watch`), and the last one done, changed under
    /// `watched`'s lock: an older one coming late is dropped.
    watch_turns: AtomicU64,
    watch_done: AtomicU64,
    /// Kept apart from `watched`, which is held while a watcher starts: the app reports the
    /// window's visibility on its main thread, which must not wait for that.
    visibility: Mutex<Visibility>,
    /// The folders watched where the system watches one folder at a time (inotify).
    folders: Mutex<Option<WatchedFolders>>,
    snapshots: PerRepository<RepositorySnapshot>,
    /// Every project on screen asks for its summary at once.
    summaries: PerRepository<RepositorySummary>,
    /// The changed files of each repository's last snapshot, which the palette searches without
    /// running git. Only the repository on screen has snapshots.
    changed: Mutex<HashMap<String, Arc<[ChangedFile]>>>,
    /// The files of the folder on screen: read when first asked for, and again only after its
    /// watcher saw a file added or removed, or the git dir change.
    trees: Mutex<HashMap<String, CachedTree>>,
    tree_reads: PerRepository<Arc<FileTree>>,
    /// The last search in contents that read every file it was given, for the next one to read
    /// only the files it found when the text grew. Dropped at any change the watcher sees.
    contents: Mutex<Option<LastContents>>,
    /// Counts the searches in contents started or stopped: a search goes on while it is the last.
    content_runs: AtomicU64,
}

impl LocalRepositories {
    pub fn new(
        backend: Arc<dyn RepositoryBackend>,
        watcher: Arc<dyn RepositoryWatcher>,
    ) -> Arc<Self> {
        Arc::new_cyclic(|this| Self {
            this: this.clone(),
            backend,
            watcher,
            colors: ColorCache::default(),
            watched: Mutex::default(),
            generation: AtomicU64::new(0),
            watch_turns: AtomicU64::new(0),
            watch_done: AtomicU64::new(0),
            visibility: Mutex::default(),
            folders: Mutex::default(),
            snapshots: PerRepository::default(),
            summaries: PerRepository::default(),
            changed: Mutex::default(),
            trees: Mutex::default(),
            tree_reads: PerRepository::default(),
            contents: Mutex::default(),
            content_runs: AtomicU64::new(0),
        })
    }

    /// Takes the next watch's turn, in the order watches were asked for, before any of them runs:
    /// two in a row end on the last.
    pub fn next_watch(&self) -> WatchTurn {
        WatchTurn(self.watch_turns.fetch_add(1, Ordering::Relaxed) + 1)
    }

    /// Watches as `Repositories::watch`, unless a watch asked later was done already.
    pub fn watch_in_turn(
        &self,
        turn: WatchTurn,
        repository: Option<&RepositoryInfo>,
        on_change: OnChange,
    ) {
        self.watch_on_screen(turn, repository, on_change);
    }
}
