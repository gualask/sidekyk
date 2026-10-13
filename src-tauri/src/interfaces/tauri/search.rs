//! Tauri adapter for the command palette's search.

use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use crate::modules::search::{SearchRequest, SearchResults};
use crate::shared::error::AppError;

#[tauri::command]
/// What was typed in the palette, ranked against the projects, the panels and the changed files
/// of the project on screen. No git runs: the files are those of its last snapshot.
pub(crate) async fn search(
    app: tauri::AppHandle,
    request: SearchRequest,
) -> Result<SearchResults, AppError> {
    blocking("search", app, move |app| {
        Ok(app.state::<ProjectsState>().search(&request))
    })
    .await
}
