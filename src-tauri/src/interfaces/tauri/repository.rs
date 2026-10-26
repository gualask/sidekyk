//! Tauri adapters for the projects' folders: a repository under review, or a folder without git.

use anyhow::Context;
use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use sidekyk_core::modules::folder::FolderKind;
use sidekyk_core::modules::preview::MarkdownDocument;
use sidekyk_core::modules::projects::Location;
use sidekyk_core::modules::repositories::Repositories;
use sidekyk_core::modules::repository::{
    ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest,
    Directory, FileContent, FileDiffRequest, FileStamp, RecentCommits, RepositoryInfo,
    RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
use sidekyk_core::modules::syntax::{SyntaxColors, SyntaxRequest};
use sidekyk_core::shared::error::AppError;

/// What `on_project` gives its work: the project's folder, as what reads it there knows it.
pub(super) struct OnProject<'a> {
    pub(super) app: &'a tauri::AppHandle,
    /// Where its folder is.
    pub(super) folder: &'a Location,
    pub(super) repositories: &'a dyn Repositories,
    pub(super) info: &'a RepositoryInfo,
}

impl OnProject<'_> {
    /// Fails, `distro_stopped`, when reading the folder would start the WSL distro that holds it:
    /// only the project's Start button may.
    pub(super) fn readable_without_starting(&self) -> anyhow::Result<()> {
        self.app
            .state::<ProjectsState>()
            .readable_without_starting(self.folder)
    }
}

/// Runs `work` off the async runtime on a project the user added, with what reads its folder.
pub(super) async fn on_project<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    project_id: String,
    work: impl FnOnce(OnProject) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        let projects = app.state::<ProjectsState>();
        let project = projects.project(&project_id)?;
        // the frontend asks only of a project that has a folder
        let (folder, info) = project.repository().context("the project has no folder")?;
        work(OnProject {
            app,
            folder,
            repositories: &*projects.repositories_at(folder),
            info: &info,
        })
    })
    .await
}

#[tauri::command]
/// Whether a project's folder is a repository or a folder without git. No git runs, so the
/// cards ask it at once; `start` starts a stopped WSL distro that holds it: the project's Start
/// button, and nothing else, asks for that.
pub(crate) async fn get_folder_kind(
    app: tauri::AppHandle,
    project_id: String,
    start: bool,
) -> Result<FolderKind, AppError> {
    on_project("get_folder_kind", app, project_id, move |on| {
        if !start {
            on.readable_without_starting()?;
        }
        on.repositories.folder_kind(on.info)
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
        on.repositories.snapshot(on.info)
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
        on.readable_without_starting()?;
        on.repositories.summary(on.info)
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
/// A project's staged and unstaged changes with whitespace ignored, when the user asks how much
/// of them is formatting.
pub(crate) async fn get_changes_ignoring_whitespace(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ChangesIgnoringWhitespace, AppError> {
    on_project("get_changes_ignoring_whitespace", app, project_id, |on| {
        on.repositories.changes_ignoring_whitespace(on.info)
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
/// The size and last change of a file of a project's tree: an image's URL carries it.
pub(crate) async fn get_file_stamp(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<FileStamp, AppError> {
    on_project("get_file_stamp", app, project_id, move |on| {
        on.repositories.file_stamp(on.info, &path)
    })
    .await
}

#[tauri::command]
/// A Markdown file of a project's tree as its preview shows it; none when it is not text.
pub(crate) async fn get_markdown_preview(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<Option<MarkdownDocument>, AppError> {
    on_project("get_markdown_preview", app, project_id, move |on| {
        on.repositories.markdown_preview(on.info, &path)
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
