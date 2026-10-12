//! Tauri adapters for the repositories under review.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::modules::repository::{
    self, FileDiff, FileDiffRequest, RepositorySnapshot, RepositorySummary,
};
use crate::shared::error::AppError;

#[tauri::command]
/// A project's changed files, area by area, and its summary.
pub(crate) async fn get_repository_snapshot(
    app: tauri::AppHandle,
    root: String,
) -> Result<RepositorySnapshot, AppError> {
    blocking("get_repository_snapshot", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        app.state::<ProjectsState>()
            .snapshot(backend.inner(), &root)
    })
    .await
}

#[tauri::command]
/// A project at a glance: branch, changed paths and line totals, without reading new files.
pub(crate) async fn get_repository_summary(
    app: tauri::AppHandle,
    root: String,
) -> Result<RepositorySummary, AppError> {
    blocking("get_repository_summary", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        app.state::<ProjectsState>().summary(backend.inner(), &root)
    })
    .await
}

#[tauri::command]
/// The unified diff of one changed file of a project, in one area.
pub(crate) async fn get_file_diff(
    app: tauri::AppHandle,
    root: String,
    request: FileDiffRequest,
) -> Result<FileDiff, AppError> {
    blocking("get_file_diff", app, move |app| {
        let info = app.state::<ProjectsState>().project(&root)?;
        let backend = app.state::<LocalRepositoryBackend>();
        repository::load_file_diff(backend.inner(), &info, &request)
    })
    .await
}
