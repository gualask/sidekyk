//! Managed Tauri state: the projects, the watcher of the one on screen, and the one place that
//! changes them.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::infrastructure::settings_store;
use crate::infrastructure::watcher::{RepositoryWatcher, WatchedChanges};
use crate::modules::projects::ProjectList;
use crate::modules::repository::{
    resolve_repository, IgnoredPaths, RepositoryChangedEvent, RepositoryInfo, RepositorySnapshot,
    REPOSITORY_CHANGED_EVENT,
};
use crate::shared::coalesce::Coalesced;
use crate::shared::sync::lock;

/// A snapshot shared by every caller that waited for it.
pub(crate) type SharedSnapshot = Result<RepositorySnapshot, Arc<anyhow::Error>>;

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
    /// At most one snapshot in flight per project; requests during it share the next one.
    snapshots: Mutex<HashMap<String, Arc<Coalesced<SharedSnapshot>>>>,
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

    pub(crate) fn snapshots(&self, root: &str) -> Arc<Coalesced<SharedSnapshot>> {
        lock(&self.snapshots)
            .entry(root.to_string())
            .or_default()
            .clone()
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
        lock(&self.snapshots).retain(|root, _| list.find(root).is_ok());
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
