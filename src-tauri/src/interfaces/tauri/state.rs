//! Managed Tauri state and the one place that switches the open repository.

use std::path::Path;
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::infrastructure::settings_store;
use crate::infrastructure::watcher::RepositoryWatcher;
use crate::modules::repository::{
    resolve_repository, RepositoryChangedEvent, RepositoryInfo, REPOSITORY_CHANGED_EVENT,
};

struct ActiveRepository {
    info: RepositoryInfo,
    _watcher: RepositoryWatcher,
}

#[derive(Default)]
pub(crate) struct RepositoryState {
    active: Mutex<Option<ActiveRepository>>,
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
    let watcher =
        RepositoryWatcher::start(info.root.clone().into(), resolved.git_dir, move || {
            let _ = emitter.emit(REPOSITORY_CHANGED_EVENT, RepositoryChangedEvent::new(&root));
        })?;

    let state = app.state::<RepositoryState>();
    *state.active.lock().unwrap_or_else(|e| e.into_inner()) = Some(ActiveRepository {
        info: info.clone(),
        _watcher: watcher,
    });

    let _ = settings_store::save_last_repository(app, &info.root);
    let _ = app.emit(
        REPOSITORY_CHANGED_EVENT,
        RepositoryChangedEvent::new(&info.root),
    );
    Ok(info)
}
