//! Tauri adapters for the repositories under review.

use std::sync::Arc;

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::modules::repository::{
    self, FileDiff, FileDiffRequest, RepositorySnapshot, RepositorySummary,
};
use crate::shared::error::{unshare, AppError};

#[tauri::command]
/// Branch, changed files and totals of a project.
pub(crate) async fn get_repository_snapshot(
    app: tauri::AppHandle,
    root: String,
) -> Result<RepositorySnapshot, AppError> {
    blocking("get_repository_snapshot", app, move |app| {
        let state = app.state::<ProjectsState>();
        let info = state.project(&root)?;
        let load = || {
            let backend = app.state::<LocalRepositoryBackend>();
            repository::load_snapshot(backend.inner(), &info)
        };
        state
            .snapshots(&root)
            .run(|| load().map_err(Arc::new))
            .map_err(unshare)
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
        let state = app.state::<ProjectsState>();
        let info = state.project(&root)?;
        let load = || {
            let backend = app.state::<LocalRepositoryBackend>();
            repository::load_summary(backend.inner(), &info)
        };
        state
            .summaries(&root)
            .run(|| load().map_err(Arc::new))
            .map_err(unshare)
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
