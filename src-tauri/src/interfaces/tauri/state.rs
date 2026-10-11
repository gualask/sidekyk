//! Managed Tauri state and the one place that switches the open repository.

use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::infrastructure::settings_store;
use crate::infrastructure::watcher::{RepositoryWatcher, WatchedChanges};
use crate::modules::repository::{
    resolve_repository, IgnoredPaths, RepositoryChangedEvent, RepositoryInfo, RepositorySnapshot,
    REPOSITORY_CHANGED_EVENT,
};
use crate::shared::coalesce::Coalesced;

struct ActiveRepository {
    info: RepositoryInfo,
    _watcher: RepositoryWatcher,
}

/// A snapshot shared by every caller that waited for it.
pub(crate) type SharedSnapshot = Result<RepositorySnapshot, Arc<anyhow::Error>>;

#[derive(Default)]
pub(crate) struct RepositoryState {
    active: Mutex<Option<ActiveRepository>>,
    /// At most one snapshot in flight; requests during it share the next one.
    pub(crate) snapshots: Coalesced<SharedSnapshot>,
}

impl RepositoryState {
    pub(crate) fn active_info(&self) -> Option<RepositoryInfo> {
        let active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        active.as_ref().map(|a| a.info.clone())
    }
}

/// Opens the repository that contains `candidate`, watches it, remembers it for the next launch,
/// and tells the frontend. The previous repository's watcher stops when it is replaced.
pub(crate) fn activate_repository(
    app: &tauri::AppHandle,
    candidate: &Path,
) -> anyhow::Result<RepositoryInfo> {
    let backend = app.state::<LocalRepositoryBackend>();
    let resolved = resolve_repository(backend.inner(), candidate)?;
    let info = resolved.info;

    let emitter = app.clone();
    let root = info.root.clone();
    let mut ignored = IgnoredPaths::new(root.clone().into());
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
            let _ = emitter.emit(REPOSITORY_CHANGED_EVENT, RepositoryChangedEvent::new(&root));
        }
    };
    let watcher = RepositoryWatcher::start(info.root.clone().into(), resolved.git_dir, on_change)?;

    let state = app.state::<RepositoryState>();
    *state.active.lock().unwrap_or_else(|e| e.into_inner()) = Some(ActiveRepository {
        info: info.clone(),
        _watcher: watcher,
    });

    tracing::info!(root = %info.root, "repository opened");
    if let Err(error) = settings_store::save_last_repository(app, &info.root) {
        tracing::warn!(error = %format!("{error:#}"), "could not remember the repository");
    }
    let _ = app.emit(
        REPOSITORY_CHANGED_EVENT,
        RepositoryChangedEvent::new(&info.root),
    );
    Ok(info)
}
