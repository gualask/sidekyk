//! Tauri adapters for the repositories under review.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use super::tray;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::modules::repository::{
    self, CommitFileDiffRequest, CommitFiles, CommitRequest, Directory, FileContent,
    FileDiffRequest, RecentCommits, RepositoryInfo, RepositorySnapshot, RepositorySummary,
    UnifiedDiff,
};
use sidekyk_core::modules::syntax::{self, ColorCache, SyntaxColors, SyntaxRequest};
use sidekyk_core::shared::error::AppError;

/// Runs `work` off the async runtime on a project the user added, with the git backend.
async fn on_project<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    root: String,
    work: impl FnOnce(&LocalRepositoryBackend, &RepositoryInfo) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        let info = app.state::<ProjectsState>().project(&root)?;
        work(app.state::<LocalRepositoryBackend>().inner(), &info)
    })
    .await
}

#[tauri::command]
/// A project's changed files, area by area, and its summary.
pub(crate) async fn get_repository_snapshot(
    app: tauri::AppHandle,
    root: String,
) -> Result<RepositorySnapshot, AppError> {
    blocking("get_repository_snapshot", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        let snapshot = app
            .state::<ProjectsState>()
            .snapshot(backend.inner(), &root);
        tray::show_read(app, &root, snapshot.as_ref().ok().map(|s| &s.summary));
        snapshot
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
        let summary = app.state::<ProjectsState>().summary(backend.inner(), &root);
        tray::show_read(app, &root, summary.as_ref().ok());
        summary
    })
    .await
}

#[tauri::command]
/// The unified diff of one changed file of a project, in one area.
pub(crate) async fn get_file_diff(
    app: tauri::AppHandle,
    root: String,
    request: FileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_project("get_file_diff", app, root, move |backend, info| {
        repository::load_file_diff(backend, info, &request)
    })
    .await
}

#[tauri::command]
/// The last commits of the branch on screen in a project, newest first.
pub(crate) async fn get_recent_commits(
    app: tauri::AppHandle,
    root: String,
) -> Result<RecentCommits, AppError> {
    on_project("get_recent_commits", app, root, move |backend, info| {
        repository::load_recent_commits(backend, info)
    })
    .await
}

#[tauri::command]
/// The files one commit of a project changed, against its parent.
pub(crate) async fn get_commit_files(
    app: tauri::AppHandle,
    root: String,
    commit: CommitRequest,
) -> Result<CommitFiles, AppError> {
    on_project("get_commit_files", app, root, move |backend, info| {
        repository::load_commit_files(backend, info, &commit)
    })
    .await
}

#[tauri::command]
/// The unified diff of one file of a commit of a project.
pub(crate) async fn get_commit_file_diff(
    app: tauri::AppHandle,
    root: String,
    request: CommitFileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_project("get_commit_file_diff", app, root, move |backend, info| {
        repository::load_commit_file_diff(backend, info, &request)
    })
    .await
}

#[tauri::command]
/// What a folder of a project holds, for the Files panel's tree; `""` is the root.
pub(crate) async fn get_directory(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<Directory, AppError> {
    blocking("get_directory", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        let tree = app
            .state::<ProjectsState>()
            .file_tree(backend.inner(), &root)?;
        Ok(tree.directory(&path))
    })
    .await
}

#[tauri::command]
/// One file of a project's tree, as the viewer shows it.
pub(crate) async fn get_file_content(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<FileContent, AppError> {
    blocking("get_file_content", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        app.state::<ProjectsState>()
            .file_content(backend.inner(), &root, &path)
    })
    .await
}

#[tauri::command]
/// The syntax colors of some lines of one version of a file of a project.
pub(crate) async fn get_syntax_colors(
    app: tauri::AppHandle,
    root: String,
    request: SyntaxRequest,
) -> Result<SyntaxColors, AppError> {
    blocking("get_syntax_colors", app, move |app| {
        let info = app.state::<ProjectsState>().project(&root)?;
        let backend = app.state::<LocalRepositoryBackend>();
        let cache = app.state::<ColorCache>();
        syntax::load_syntax_colors(backend.inner(), &info, cache.inner(), &request)
    })
    .await
}
