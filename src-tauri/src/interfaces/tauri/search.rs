//! Tauri adapter for the command palette's search.

use tauri::ipc::Channel;
use tauri::Manager;

use super::blocking::blocking;
use super::notes::project_book;
use super::repository::on_project;
use super::state::ProjectsState;
use crate::infrastructure::notes_files::NotesFiles;
use sidekyk_core::modules::notes::{Book, NotesStore};
use sidekyk_core::modules::search::{
    self, search_every_book, search_notes, ContentEnd, ContentFile, SearchRequest, SearchResults,
};
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// What was typed in the palette, ranked against the projects and the note lists and notes of the
/// Inbox and every project at all projects, or the panels and the files, note lists and notes of
/// the project on screen. Git runs only to list the files, when its tree is not read yet; the
/// notes are read from disk only when not already in memory.
pub(crate) async fn search(
    app: tauri::AppHandle,
    request: SearchRequest,
) -> Result<SearchResults, AppError> {
    blocking("search", app, move |app| {
        let notes = app.state::<NotesStore>();
        let files = app.state::<NotesFiles>();
        let query = request.query.as_str();
        Ok(app.state::<ProjectsState>().search(
            &request,
            |project| {
                notes
                    .with_notes(files.inner(), &project_book(project), |lists, found| {
                        search_notes(query, &project.id, lists, found)
                    })
                    .inspect_err(
                        |error| tracing::debug!(error = %format!("{error:#}"), "no notes to search"),
                    )
                    .ok()
            },
            |projects| {
                // the Inbox first: equal scores keep the books' order
                let books: Vec<Book> = std::iter::once(Book::Inbox)
                    .chain(projects.iter().map(project_book))
                    .collect();
                notes.with_every_book(files.inner(), &books, |found| {
                    search_every_book(query, found)
                })
            },
        ))
    })
    .await
}

#[tauri::command]
/// The lines of the project's files where `query` is, sent through `on_files` as they are found
/// (`⌘F`); a newer search stops this one. A stopped WSL distro is not started for it.
pub(crate) async fn search_contents(
    app: tauri::AppHandle,
    project_id: String,
    query: String,
    on_files: Channel<Vec<ContentFile>>,
) -> Result<ContentEnd, AppError> {
    on_project("search_contents", app, project_id, move |on| {
        on.readable_without_starting()?;
        on.repositories.search_contents(on.info, &query, &|files| {
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

#[tauri::command]
/// The names that match `query`, best first, by their index: the Move dialog's projects and lists.
/// A few names, ranked at once on the async runtime.
pub(crate) async fn rank_names(query: String, names: Vec<String>) -> Vec<usize> {
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    search::rank_names(&query, &names)
}
