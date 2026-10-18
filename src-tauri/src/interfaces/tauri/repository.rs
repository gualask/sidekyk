//! Tauri adapters for the repositories under review.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use super::tray;
use sidekyk_core::modules::repositories::Repositories;
use sidekyk_core::modules::repository::{
    CommitFileDiffRequest, CommitFiles, CommitRequest, Directory, FileContent, FileDiffRequest,
    RecentCommits, RepositoryInfo, RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
use sidekyk_core::modules::syntax::{SyntaxColors, SyntaxRequest};
use sidekyk_core::shared::error::AppError;

/// Runs `work` off the async runtime on a project the user added, with what reads its repository.
pub(super) async fn on_project<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    root: String,
    work: impl FnOnce(&tauri::AppHandle, &dyn Repositories, &RepositoryInfo) -> anyhow::Result<T>
        + Send
        + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        let projects = app.state::<ProjectsState>();
        let info = projects.project(&root)?;
        work(app, projects.repositories(), &info)
    })
    .await
}

#[tauri::command]
/// A project's changed files, area by area, and its summary.
pub(crate) async fn get_repository_snapshot(
    app: tauri::AppHandle,
    root: String,
) -> Result<RepositorySnapshot, AppError> {
    on_project(
        "get_repository_snapshot",
        app,
        root,
        |app, repositories, info| {
            let snapshot = repositories.snapshot(info);
            tray::show_read(app, &info.root, snapshot.as_ref().ok().map(|s| &s.summary));
            snapshot
        },
    )
    .await
}

#[tauri::command]
/// A project at a glance: branch, changed paths and line totals, without reading new files.
pub(crate) async fn get_repository_summary(
    app: tauri::AppHandle,
    root: String,
) -> Result<RepositorySummary, AppError> {
    on_project(
        "get_repository_summary",
        app,
        root,
        |app, repositories, info| {
            let summary = repositories.summary(info);
            tray::show_read(app, &info.root, summary.as_ref().ok());
            summary
        },
    )
    .await
}

#[tauri::command]
/// The unified diff of one changed file of a project, in one area.
pub(crate) async fn get_file_diff(
    app: tauri::AppHandle,
    root: String,
    request: FileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_project("get_file_diff", app, root, move |_, repositories, info| {
        repositories.file_diff(info, &request)
    })
    .await
}

#[tauri::command]
/// The last commits of the branch on screen in a project, newest first.
pub(crate) async fn get_recent_commits(
    app: tauri::AppHandle,
    root: String,
) -> Result<RecentCommits, AppError> {
    on_project("get_recent_commits", app, root, |_, repositories, info| {
        repositories.recent_commits(info)
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
    on_project(
        "get_commit_files",
        app,
        root,
        move |_, repositories, info| repositories.commit_files(info, &commit),
    )
    .await
}

#[tauri::command]
/// The unified diff of one file of a commit of a project.
pub(crate) async fn get_commit_file_diff(
    app: tauri::AppHandle,
    root: String,
    request: CommitFileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_project(
        "get_commit_file_diff",
        app,
        root,
        move |_, repositories, info| repositories.commit_file_diff(info, &request),
    )
    .await
}

#[tauri::command]
/// What a folder of a project holds, for the Files panel's tree; `""` is the root.
pub(crate) async fn get_directory(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<Directory, AppError> {
    on_project("get_directory", app, root, move |_, repositories, info| {
        repositories.directory(info, &path)
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
    on_project(
        "get_file_content",
        app,
        root,
        move |_, repositories, info| repositories.file_content(info, &path),
    )
    .await
}

#[tauri::command]
/// The syntax colors of some lines of one version of a file of a project.
pub(crate) async fn get_syntax_colors(
    app: tauri::AppHandle,
    root: String,
    request: SyntaxRequest,
) -> Result<SyntaxColors, AppError> {
    on_project(
        "get_syntax_colors",
        app,
        root,
        move |_, repositories, info| repositories.syntax_colors(info, &request),
    )
    .await
}
