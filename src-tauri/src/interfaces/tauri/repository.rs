//! Tauri adapters for the repository under review.

use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::state::{activate_repository, RepositoryState};
use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::modules::repository::{
    self, FileDiff, FileDiffRequest, RepositoryInfo, RepositorySnapshot,
};
use crate::shared::error::{unshare, user_facing, user_facing_code, AppError, UserFacingErrorCode};

fn active_repository(app: &tauri::AppHandle) -> anyhow::Result<RepositoryInfo> {
    app.state::<RepositoryState>()
        .active_info()
        .ok_or_else(|| user_facing(UserFacingErrorCode::NoRepositoryOpen))
}

/// Runs blocking git work off the async runtime, and logs how long it took and how it failed.
async fn blocking<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    work: impl FnOnce(&tauri::AppHandle) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    let started = Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || work(&app))
        .await
        .map_err(anyhow::Error::from)
        .and_then(|result| result);
    let ms = started.elapsed().as_millis() as u64;
    match &result {
        Ok(_) => tracing::debug!(command, ms, "command"),
        Err(error) => match user_facing_code(error) {
            // Expected states such as no repository open: the UI shows them.
            Some(code) => tracing::info!(command, ms, code = code.as_str(), "command refused"),
            None => tracing::error!(command, ms, error = %format!("{error:#}"), "command failed"),
        },
    }
    result.map_err(AppError::from)
}

#[tauri::command]
/// The repository open now, if any.
pub(crate) fn get_active_repository(app: tauri::AppHandle) -> Option<RepositoryInfo> {
    app.state::<RepositoryState>().active_info()
}

#[tauri::command]
/// Asks for a folder and opens the repository that contains it. `None` when cancelled.
pub(crate) async fn pick_repository(
    app: tauri::AppHandle,
) -> Result<Option<RepositoryInfo>, AppError> {
    blocking("pick_repository", app, |app| {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("Open repository")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        activate_repository(app, &folder.into_path()?).map(Some)
    })
    .await
}

#[tauri::command]
/// Branch, changed files and totals of the open repository.
pub(crate) async fn get_repository_snapshot(
    app: tauri::AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    blocking("get_repository_snapshot", app, |app| {
        let load = || {
            let info = active_repository(app)?;
            let backend = app.state::<LocalRepositoryBackend>();
            repository::load_snapshot(backend.inner(), &info)
        };
        let state = app.state::<RepositoryState>();
        state
            .snapshots
            .run(|| load().map_err(Arc::new))
            .map_err(unshare)
    })
    .await
}

#[tauri::command]
/// The unified diff of one changed file in one area.
pub(crate) async fn get_file_diff(
    app: tauri::AppHandle,
    request: FileDiffRequest,
) -> Result<FileDiff, AppError> {
    blocking("get_file_diff", app, move |app| {
        let info = active_repository(app)?;
        let backend = app.state::<LocalRepositoryBackend>();
        repository::load_file_diff(backend.inner(), &info, &request)
    })
    .await
}
