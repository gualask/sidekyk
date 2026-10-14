//! Managed Tauri state: the projects, the watcher of the one on screen, whether the window shows,
//! and the one place that changes them.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::infrastructure::settings_store;
use crate::infrastructure::watcher::{RepositoryWatcher, WatchedChanges};
use crate::modules::projects::ProjectList;
use crate::modules::repository::{
    self, resolve_repository, ChangedFile, IgnoredPaths, RepositoryBackend, RepositoryChangedEvent,
    RepositoryInfo, RepositorySnapshot, RepositorySummary, REPOSITORY_CHANGED_EVENT,
};
use crate::modules::search::{self, SearchRequest, SearchResults};
use crate::shared::coalesce::Coalesced;
use crate::shared::error::unshare;
use crate::shared::sync::lock;

/// A result shared by every caller that waited for it.
type Shared<T> = Result<T, Arc<anyhow::Error>>;

/// One computation per project at a time; requests that arrive during it share the next one.
struct PerProject<T> {
    runs: Mutex<HashMap<String, Arc<Coalesced<Shared<T>>>>>,
}

impl<T> Default for PerProject<T> {
    fn default() -> Self {
        Self {
            runs: Mutex::default(),
        }
    }
}

impl<T: Clone> PerProject<T> {
    fn run(&self, root: &str, work: impl FnOnce() -> anyhow::Result<T>) -> anyhow::Result<T> {
        let coalesced = lock(&self.runs)
            .entry(root.to_string())
            .or_default()
            .clone();
        coalesced.run(|| work().map_err(Arc::new)).map_err(unshare)
    }

    /// Forgets the projects no longer in the list.
    fn retain(&self, list: &ProjectList) {
        lock(&self.runs).retain(|root, _| list.find(root).is_ok());
    }
}

/// While the window is minimized, hidden or covered, as its page tells, the watcher keeps
/// watching but reports nothing, and only marks what it saw.
#[derive(Default)]
struct WindowState {
    hidden: bool,
    /// The project on screen, when its watcher saw a change that may show while hidden.
    missed: Option<String>,
}

struct Watched {
    root: String,
    /// `None` when the watcher could not start, such as a repository moved away.
    _watcher: Option<RepositoryWatcher>,
}

#[derive(Default)]
pub(crate) struct ProjectsState {
    list: Mutex<ProjectList>,
    /// Only the project on screen is watched. Kept apart from `list`, since starting a watcher
    /// can take a while (on Linux it walks the tree) and must not hold up snapshots.
    watched: Mutex<Option<Watched>>,
    /// Kept apart from `watched`, which is held while a watcher starts: the page reports its
    /// visibility on the main thread, which must not wait for that.
    window: Mutex<WindowState>,
    snapshots: PerProject<RepositorySnapshot>,
    /// Every project on screen asks for its summary at once.
    summaries: PerProject<RepositorySummary>,
    /// The changed files of each project's last snapshot, which the palette searches without
    /// running git. Only the project on screen has snapshots.
    changed: Mutex<HashMap<String, Arc<[ChangedFile]>>>,
}

impl ProjectsState {
    pub(crate) fn list(&self) -> ProjectList {
        lock(&self.list).clone()
    }

    /// A project the user added. Any other root is refused, so the frontend cannot point git
    /// at a folder of its choosing.
    pub(crate) fn project(&self, root: &str) -> anyhow::Result<RepositoryInfo> {
        lock(&self.list).find(root).cloned()
    }

    /// A project's snapshot, sharing the one in flight.
    pub(crate) fn snapshot(
        &self,
        backend: &dyn RepositoryBackend,
        root: &str,
    ) -> anyhow::Result<RepositorySnapshot> {
        let project = self.project(root)?;
        self.snapshots.run(root, || {
            let snapshot = repository::load_snapshot(backend, &project);
            let mut changed = lock(&self.changed);
            match &snapshot {
                Ok(snapshot) => {
                    changed.insert(root.to_string(), snapshot.files.as_slice().into());
                }
                // a repository moved away has nothing left to search
                Err(_) => {
                    changed.remove(root);
                }
            }
            snapshot
        })
    }

    /// The palette's matches: the projects, the panels the frontend names, and the changed
    /// files of the project on screen as its last snapshot found them.
    pub(crate) fn search(&self, request: &SearchRequest) -> SearchResults {
        let list = self.list();
        let files = list
            .active()
            .and_then(|active| lock(&self.changed).get(&active.root).cloned())
            .unwrap_or_else(|| Arc::from([]));
        search::search(request, &list.projects, &files)
    }

    /// A project's summary, sharing the one in flight.
    pub(crate) fn summary(
        &self,
        backend: &dyn RepositoryBackend,
        root: &str,
    ) -> anyhow::Result<RepositorySummary> {
        let project = self.project(root)?;
        self.summaries
            .run(root, || repository::load_summary(backend, &project))
    }

    /// Records whether the window shows. Showing again returns the project on screen if its
    /// watcher saw a change meanwhile, for the frontend to read again.
    pub(crate) fn set_window_visible(&self, visible: bool) -> Option<String> {
        let mut window = lock(&self.window);
        window.hidden = !visible;
        let missed = if visible { window.missed.take() } else { None };
        tracing::debug!(visible, missed = missed.is_some(), "window visibility");
        missed
    }

    /// Replaces the list at startup, before anything is watched.
    pub(crate) fn restore(&self, list: ProjectList) {
        *lock(&self.list) = list;
    }

    /// Changes the list, stores it, and watches the project now on screen.
    pub(crate) fn update(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<()>,
    ) -> anyhow::Result<ProjectList> {
        let list = {
            let mut list = lock(&self.list);
            change(&mut list)?;
            // stored while still locked, so concurrent changes reach the disk in their order
            if let Err(error) = settings_store::save_projects(app, &list) {
                tracing::warn!(error = %format!("{error:#}"), "could not store the projects");
            }
            list.clone()
        };
        self.snapshots.retain(&list);
        self.summaries.retain(&list);
        lock(&self.changed).retain(|root, _| list.find(root).is_ok());
        watch_active(app);
        Ok(list)
    }
}

/// Watches the project on screen, if it is not watched yet, and stops watching the previous one.
/// Calls racing each other end on the project on screen after the last of them.
pub(crate) fn watch_active(app: &tauri::AppHandle) {
    let state = app.state::<ProjectsState>();
    let mut watched = lock(&state.watched);
    let Some(active) = state.list().active().cloned() else {
        *watched = None;
        return;
    };
    if watched.as_ref().is_some_and(|w| w.root == active.root) {
        return;
    }
    // the previous watcher stops before the next one walks its tree
    *watched = None;
    // a project put on screen is read in full anyway
    lock(&state.window).missed = None;
    let watcher = match start_watcher(app, &active.root) {
        Ok(watcher) => {
            tracing::info!(root = %active.root, "project opened");
            Some(watcher)
        }
        Err(error) => {
            tracing::warn!(
                root = %active.root,
                error = %format!("{error:#}"),
                "could not watch the project"
            );
            None
        }
    };
    *watched = Some(Watched {
        root: active.root,
        _watcher: watcher,
    });
}

fn start_watcher(app: &tauri::AppHandle, root: &str) -> anyhow::Result<RepositoryWatcher> {
    let backend = app.state::<LocalRepositoryBackend>();
    let resolved = resolve_repository(backend.inner(), Path::new(root))?;

    let emitter = app.clone();
    let root = resolved.info.root;
    let mut ignored = IgnoredPaths::new(root.clone().into());
    let event = RepositoryChangedEvent::new(&root);
    let on_change = move |changes: WatchedChanges| {
        // The index may now track a file in an ignored directory, or the excludes changed.
        if changes.git_dir {
            ignored.forget();
        }
        let state = emitter.state::<ProjectsState>();
        // held until the batch is settled, so the window cannot show in between and miss it
        let mut window = lock(&state.window);
        // nobody looks: no `check-ignore`, no refresh, only a mark for when the window shows
        if window.hidden {
            let marked = changes.git_dir || ignored.any_maybe_visible(&changes.worktree);
            if marked {
                window.missed = Some(event.root.clone());
            }
            tracing::debug!(
                git_dir = changes.git_dir,
                worktree_paths = changes.worktree.len(),
                marked,
                "watcher batch while hidden"
            );
            return;
        }
        drop(window);
        let backend = emitter.state::<LocalRepositoryBackend>();
        let visible = changes.git_dir || ignored.any_visible(backend.inner(), &changes.worktree);
        tracing::debug!(
            git_dir = changes.git_dir,
            worktree_paths = changes.worktree.len(),
            visible,
            "watcher batch"
        );
        if visible {
            let _ = emitter.emit(REPOSITORY_CHANGED_EVENT, event.clone());
        }
    };
    RepositoryWatcher::start(root.clone().into(), resolved.git_dir, on_change)
}

/// Adds the repository that contains `candidate` and puts it on screen.
pub(crate) fn open_folder(app: &tauri::AppHandle, candidate: &Path) -> anyhow::Result<ProjectList> {
    let backend = app.state::<LocalRepositoryBackend>();
    let info = resolve_repository(backend.inner(), candidate)?.info;
    app.state::<ProjectsState>().update(app, |list| {
        list.add(info);
        Ok(())
    })
}
