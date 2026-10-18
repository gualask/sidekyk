//! Tauri adapters for the repositories under review.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use super::tray;
use sidekyk_core::modules::projects::Project;
use sidekyk_core::modules::repositories::Repositories;
use sidekyk_core::modules::repository::{
    CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest, Directory, FileContent,
    FileDiffRequest, RecentCommits, RepositoryInfo, RepositorySnapshot, RepositorySummary,
    UnifiedDiff,
};
use sidekyk_core::modules::syntax::{SyntaxColors, SyntaxRequest};
use sidekyk_core::shared::error::AppError;

/// What `on_project` gives its work: the project, and its repository as what reads it there
/// knows it.
pub(super) struct OnProject<'a> {
    pub(super) app: &'a tauri::AppHandle,
    pub(super) project: &'a Project,
    pub(super) repositories: &'a dyn Repositories,
    pub(super) info: &'a RepositoryInfo,
}

/// Runs `work` off the async runtime on a project the user added, with what reads its repository.
pub(super) async fn on_project<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    project_id: String,
    work: impl FnOnce(OnProject) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        let projects = app.state::<ProjectsState>();
        let project = projects.project(&project_id)?;
        work(OnProject {
            app,
            project: &project,
            repositories: &*projects.repositories_of(&project),
            info: &project.repository(),
        })
    })
    .await
}

#[tauri::command]
/// A project's changed files, area by area, and its summary.
pub(crate) async fn get_repository_snapshot(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<RepositorySnapshot, AppError> {
    on_project("get_repository_snapshot", app, project_id, |on| {
        let snapshot = on.repositories.snapshot(on.info);
        let summary = snapshot.as_ref().ok().map(|s| &s.summary);
        tray::show_read(on.app, &on.project.id, summary);
        snapshot
    })
    .await
}

#[tauri::command]
/// A project at a glance: branch, changed paths and line totals, without reading new files.
pub(crate) async fn get_repository_summary(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<RepositorySummary, AppError> {
    on_project("get_repository_summary", app, project_id, |on| {
        // the cards never start a stopped WSL distro
        on.app
            .state::<ProjectsState>()
            .readable_without_starting(on.project)?;
        let summary = on.repositories.summary(on.info);
        tray::show_read(on.app, &on.project.id, summary.as_ref().ok());
        summary
    })
    .await
}

#[tauri::command]
/// The unified diff of one changed file of a project, in one area.
pub(crate) async fn get_file_diff(
    app: tauri::AppHandle,
    project_id: String,
    request: FileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_project("get_file_diff", app, project_id, move |on| {
        on.repositories.file_diff(on.info, &request)
    })
    .await
}

#[tauri::command]
/// The last commits of the branch on screen in a project, newest first.
pub(crate) async fn get_recent_commits(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<RecentCommits, AppError> {
    on_project("get_recent_commits", app, project_id, |on| {
        on.repositories.recent_commits(on.info)
    })
    .await
}

#[tauri::command]
/// The lines each commit of the branch on screen in a project changed since `since` (Unix
/// seconds), newest first.
pub(crate) async fn get_commit_activity(
    app: tauri::AppHandle,
    project_id: String,
    since: i64,
) -> Result<CommitActivity, AppError> {
    on_project("get_commit_activity", app, project_id, move |on| {
        on.repositories.commit_activity(on.info, since)
    })
    .await
}

#[tauri::command]
/// The files one commit of a project changed, against its parent.
pub(crate) async fn get_commit_files(
    app: tauri::AppHandle,
    project_id: String,
    commit: CommitRequest,
) -> Result<CommitFiles, AppError> {
    on_project("get_commit_files", app, project_id, move |on| {
        on.repositories.commit_files(on.info, &commit)
    })
    .await
}

#[tauri::command]
/// The unified diff of one file of a commit of a project.
pub(crate) async fn get_commit_file_diff(
    app: tauri::AppHandle,
    project_id: String,
    request: CommitFileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_project("get_commit_file_diff", app, project_id, move |on| {
        on.repositories.commit_file_diff(on.info, &request)
    })
    .await
}

#[tauri::command]
/// What a folder of a project holds, for the Files panel's tree; `""` is the root.
pub(crate) async fn get_directory(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<Directory, AppError> {
    on_project("get_directory", app, project_id, move |on| {
        on.repositories.directory(on.info, &path)
    })
    .await
}

#[tauri::command]
/// One file of a project's tree, as the viewer shows it.
pub(crate) async fn get_file_content(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<FileContent, AppError> {
    on_project("get_file_content", app, project_id, move |on| {
        on.repositories.file_content(on.info, &path)
    })
    .await
}

#[tauri::command]
/// The syntax colors of some lines of one version of a file of a project.
pub(crate) async fn get_syntax_colors(
    app: tauri::AppHandle,
    project_id: String,
    request: SyntaxRequest,
) -> Result<SyntaxColors, AppError> {
    on_project("get_syntax_colors", app, project_id, move |on| {
        on.repositories.syntax_colors(on.info, &request)
    })
    .await
}
