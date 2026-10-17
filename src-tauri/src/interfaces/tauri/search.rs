//! Tauri adapter for the command palette's search.

use tauri::ipc::Channel;
use tauri::Manager;

use super::blocking::blocking;
use super::state::ProjectsState;
use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::infrastructure::notes_files::NotesFiles;
use crate::modules::notes::NotesStore;
use crate::modules::search::{ContentEnd, ContentFile, SearchRequest, SearchResults};
use crate::shared::error::AppError;

#[tauri::command]
/// What was typed in the palette, ranked against the projects, the panels and the files, note
/// lists and notes of the project on screen. Git runs only to list the files, when its tree is not
/// read yet; the notes are read from disk only when not already in memory.
pub(crate) async fn search(
    app: tauri::AppHandle,
    request: SearchRequest,
) -> Result<SearchResults, AppError> {
    blocking("search", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        let notes = app.state::<NotesStore>();
        let files = app.state::<NotesFiles>();
        Ok(app
            .state::<ProjectsState>()
            .search(backend.inner(), &request, |root| {
                notes
                    .notes(files.inner(), root)
                    .inspect_err(
                        |error| tracing::debug!(error = %format!("{error:#}"), "no notes to search"),
                    )
                    .ok()
            }))
    })
    .await
}

#[tauri::command]
/// The lines of the project's files where `query` is, sent through `on_files` as they are found
/// (`⌘F`); a newer search stops this one.
pub(crate) async fn search_contents(
    app: tauri::AppHandle,
    root: String,
    query: String,
    on_files: Channel<Vec<ContentFile>>,
) -> Result<ContentEnd, AppError> {
    blocking("search_contents", app, move |app| {
        let backend = app.state::<LocalRepositoryBackend>();
        app.state::<ProjectsState>()
            .search_contents(backend.inner(), &root, &query, &|files| {
                // the page went away: nothing left to stop
                let _ = on_files.send(files);
            })
    })
    .await
}

#[tauri::command]
/// Stops the search in contents going on: the palette closed.
pub(crate) fn stop_content_search(state: tauri::State<'_, ProjectsState>) {
    state.stop_content_search();
}
