//! Tauri adapters for the projects' folders, each named by its id: a repository under review, or
//! a folder without git.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use sidekyk_core::app::machines::Start;
use sidekyk_core::modules::folder::{
    Directory, FileContent, FileStamp, FolderKind, RecentFiles, RepositoryInfo,
};
use sidekyk_core::modules::preview::MarkdownDocument;
use sidekyk_core::modules::reader::Repositories;
use sidekyk_core::modules::repository::{
    ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest,
    FileDiffRequest, RecentCommits, RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
use sidekyk_core::modules::syntax::{SyntaxColors, SyntaxRequest};
use sidekyk_core::shared::error::AppError;

/// What `on_folder` gives its work: a project's folder, as what reads it there knows it.
pub(super) struct OnFolder<'a> {
    pub(super) repositories: &'a dyn Repositories,
    pub(super) info: &'a RepositoryInfo,
}

/// Runs `work` off the async runtime on a folder of a project the user added, with what reads it,
/// once `start` allows it: `Start::Never` fails `distro_stopped` for a stopped WSL distro.
pub(super) async fn on_folder<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    folder_id: String,
    start: Start,
    work: impl FnOnce(OnFolder) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        let projects = app.state::<ProjectsState>();
        let (project, folder) = projects.folder(&folder_id)?;
        work(OnFolder {
            repositories: &*projects.repositories_at(&folder.location, start)?,
            info: &folder.repository(&project),
        })
    })
    .await
}

#[tauri::command]
/// Whether a folder of a project is a repository or a folder without git. No git runs, so the
/// rows ask it at once; `start` starts a stopped WSL distro that holds it: the project's Start
/// button, and nothing else, asks for that.
pub(crate) async fn get_folder_kind(
    app: tauri::AppHandle,
    folder_id: String,
    start: bool,
) -> Result<FolderKind, AppError> {
    on_folder(
        "get_folder_kind",
        app,
        folder_id,
        if start { Start::May } else { Start::Never },
        move |on| on.repositories.folder_kind(on.info),
    )
    .await
}

#[tauri::command]
/// A project's changed files, area by area, and its summary.
pub(crate) async fn get_repository_snapshot(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<RepositorySnapshot, AppError> {
    on_folder(
        "get_repository_snapshot",
        app,
        folder_id,
        Start::May,
        |on| on.repositories.snapshot(on.info),
    )
    .await
}

#[tauri::command]
/// A project at a glance: branch, changed paths and line totals, without reading new files.
pub(crate) async fn get_repository_summary(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<RepositorySummary, AppError> {
    on_folder(
        "get_repository_summary",
        app,
        folder_id,
        Start::Never,
        |on| on.repositories.summary(on.info),
    )
    .await
}

#[tauri::command]
/// The unified diff of one changed file of a project, in one area.
pub(crate) async fn get_file_diff(
    app: tauri::AppHandle,
    folder_id: String,
    request: FileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_folder("get_file_diff", app, folder_id, Start::May, move |on| {
        on.repositories.file_diff(on.info, &request)
    })
    .await
}

#[tauri::command]
/// A project's staged and unstaged changes with whitespace ignored, when the user asks how much
/// of them is formatting.
pub(crate) async fn get_changes_ignoring_whitespace(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<ChangesIgnoringWhitespace, AppError> {
    on_folder(
        "get_changes_ignoring_whitespace",
        app,
        folder_id,
        Start::May,
        |on| on.repositories.changes_ignoring_whitespace(on.info),
    )
    .await
}

#[tauri::command]
/// The last commits of the branch on screen in a project, newest first.
pub(crate) async fn get_recent_commits(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<RecentCommits, AppError> {
    on_folder("get_recent_commits", app, folder_id, Start::May, |on| {
        on.repositories.recent_commits(on.info)
    })
    .await
}

#[tauri::command]
/// The lines each commit of the branch on screen in a project changed since `since` (Unix
/// seconds), newest first.
pub(crate) async fn get_commit_activity(
    app: tauri::AppHandle,
    folder_id: String,
    since: i64,
) -> Result<CommitActivity, AppError> {
    on_folder(
        "get_commit_activity",
        app,
        folder_id,
        Start::May,
        move |on| on.repositories.commit_activity(on.info, since),
    )
    .await
}

#[tauri::command]
/// The files one commit of a project changed, against its parent.
pub(crate) async fn get_commit_files(
    app: tauri::AppHandle,
    folder_id: String,
    commit: CommitRequest,
) -> Result<CommitFiles, AppError> {
    on_folder("get_commit_files", app, folder_id, Start::May, move |on| {
        on.repositories.commit_files(on.info, &commit)
    })
    .await
}

#[tauri::command]
/// The unified diff of one file of a commit of a project.
pub(crate) async fn get_commit_file_diff(
    app: tauri::AppHandle,
    folder_id: String,
    request: CommitFileDiffRequest,
) -> Result<UnifiedDiff, AppError> {
    on_folder(
        "get_commit_file_diff",
        app,
        folder_id,
        Start::May,
        move |on| on.repositories.commit_file_diff(on.info, &request),
    )
    .await
}

#[tauri::command]
/// What a folder of a project holds, for the Files panel's tree; `""` is the root.
pub(crate) async fn get_directory(
    app: tauri::AppHandle,
    folder_id: String,
    path: String,
) -> Result<Directory, AppError> {
    on_folder("get_directory", app, folder_id, Start::May, move |on| {
        on.repositories.directory(on.info, &path)
    })
    .await
}

#[tauri::command]
/// The files of a project's tree by their last change, newest first: the Files panel's Recent.
pub(crate) async fn get_recent_files(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<RecentFiles, AppError> {
    on_folder("get_recent_files", app, folder_id, Start::May, move |on| {
        on.repositories.recent_files(on.info)
    })
    .await
}

#[tauri::command]
/// One file of a project's tree, as the viewer shows it.
pub(crate) async fn get_file_content(
    app: tauri::AppHandle,
    folder_id: String,
    path: String,
) -> Result<FileContent, AppError> {
    on_folder("get_file_content", app, folder_id, Start::May, move |on| {
        on.repositories.file_content(on.info, &path)
    })
    .await
}

#[tauri::command]
/// The folders of a project whose tree holds the file at `path`, a note names
/// (`ProjectsState::folders_holding`).
pub(crate) async fn folders_holding(
    app: tauri::AppHandle,
    project_id: String,
    first: Option<String>,
    path: String,
) -> Result<Vec<String>, AppError> {
    blocking("folders_holding", app, move |app| {
        app.state::<ProjectsState>()
            .folders_holding(&project_id, first.as_deref(), &path)
    })
    .await
}

#[tauri::command]
/// The size and last change of a file of a project's tree: an image's URL carries it.
pub(crate) async fn get_file_stamp(
    app: tauri::AppHandle,
    folder_id: String,
    path: String,
) -> Result<FileStamp, AppError> {
    on_folder("get_file_stamp", app, folder_id, Start::May, move |on| {
        on.repositories.file_stamp(on.info, &path)
    })
    .await
}

#[tauri::command]
/// The size of a git object, a side of an image's diff.
pub(crate) async fn get_blob_size(
    app: tauri::AppHandle,
    folder_id: String,
    blob: String,
) -> Result<u64, AppError> {
    on_folder("get_blob_size", app, folder_id, Start::May, move |on| {
        on.repositories.blob_size(on.info, &blob)
    })
    .await
}

#[tauri::command]
/// A Markdown file of a project's tree as its preview shows it; none when it is not text.
pub(crate) async fn get_markdown_preview(
    app: tauri::AppHandle,
    folder_id: String,
    path: String,
) -> Result<Option<MarkdownDocument>, AppError> {
    on_folder(
        "get_markdown_preview",
        app,
        folder_id,
        Start::May,
        move |on| on.repositories.markdown_preview(on.info, &path),
    )
    .await
}

#[tauri::command]
/// The syntax colors of some lines of one version of a file of a project.
pub(crate) async fn get_syntax_colors(
    app: tauri::AppHandle,
    folder_id: String,
    request: SyntaxRequest,
) -> Result<SyntaxColors, AppError> {
    on_folder("get_syntax_colors", app, folder_id, Start::May, move |on| {
        on.repositories.syntax_colors(on.info, &request)
    })
    .await
}
