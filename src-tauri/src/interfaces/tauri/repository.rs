//! Tauri adapters for the repository under review.

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::state::{activate_repository, RepositoryState};
use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::modules::repository::{
    self, FileDiff, FileDiffRequest, RepositoryInfo, RepositorySnapshot,
};
use crate::shared::error::{user_facing, AppError, UserFacingErrorCode};

fn active_repository(app: &tauri::AppHandle) -> anyhow::Result<RepositoryInfo> {
    app.state::<RepositoryState>()
        .active_info()
        .ok_or_else(|| user_facing(UserFacingErrorCode::NoRepositoryOpen))
}

/// Runs blocking git work off the async runtime.
async fn blocking<T: Send + 'static>(
    app: tauri::AppHandle,
    work: impl FnOnce(&tauri::AppHandle) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || work(&app))
        .await
        .map_err(anyhow::Error::from)?
        .map_err(AppError::from)
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
    blocking(app, |app| {
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
    blocking(app, |app| {
        let info = active_repository(app)?;
        let backend = app.state::<LocalRepositoryBackend>();
        repository::load_snapshot(backend.inner(), &info)
    })
    .await
}

#[tauri::command]
/// The unified diff of one changed file in one area.
pub(crate) async fn get_file_diff(
    app: tauri::AppHandle,
    request: FileDiffRequest,
) -> Result<FileDiff, AppError> {
    blocking(app, move |app| {
        let info = active_repository(app)?;
        let backend = app.state::<LocalRepositoryBackend>();
        repository::load_file_diff(backend.inner(), &info, &request)
    })
    .await
}
