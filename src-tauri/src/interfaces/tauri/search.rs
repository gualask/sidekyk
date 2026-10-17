//! Tauri adapter for the command palette's search.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::modules::search::{SearchRequest, SearchResults};
use crate::shared::error::AppError;

#[tauri::command]
/// What was typed in the palette, ranked against the projects, the panels and the files of the
/// project on screen. Git runs only to list them, when its tree is not read yet.
pub(crate) async fn search(
    app: tauri::AppHandle,
    request: SearchRequest,
) -> Result<SearchResults, AppError> {
    blocking("search", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        Ok(app
            .state::<ProjectsState>()
            .search(backend.inner(), &request))
    })
    .await
}
