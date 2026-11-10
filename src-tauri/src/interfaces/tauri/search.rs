//! Tauri adapter for the command palette's search.

use tauri::ipc::Channel;
use tauri::Manager;

use super::blocking::blocking;
use super::repository::on_folder;
use crate::infrastructure::notes_files::NotesFiles;
use sidekyk_core::app::machines::Start;
use sidekyk_core::app::palette;
use sidekyk_core::app::projects::Projects;
use sidekyk_core::modules::notes::NotesStore;
use sidekyk_core::modules::search::{
    self, ContentEnd, ContentFile, FileMatches, SearchRequest, SearchResults,
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
        let (store, files) = (app.state::<NotesStore>(), app.state::<NotesFiles>());
        Ok(palette::search(
            &app.state::<Projects>(),
            &store,
            files.inner(),
            &request,
        ))
    })
    .await
}

#[tauri::command]
/// The lines of a project's folder's files where `query` is, sent through `on_files` as they are found
/// (`⌘F`); a newer search stops this one. A stopped WSL distro is not started for it.
pub(crate) async fn search_contents(
    app: tauri::AppHandle,
    folder_id: String,
    query: String,
    on_files: Channel<Vec<ContentFile>>,
) -> Result<ContentEnd, AppError> {
    on_folder("search_contents", app, folder_id, Start::Never, move |on| {
        on.reader.search_contents(&on.info, &query, &|files| {
            // the page went away: nothing left to stop
            let _ = on_files.send(files);
        })
    })
    .await
}

#[tauri::command]
/// The files of a project's folder that match `query` best, as the palette ranks them: what a
/// note's `@` suggests. Nothing for an empty query, nor while the folder's WSL distro is stopped.
pub(crate) async fn search_files(
    app: tauri::AppHandle,
    folder_id: String,
    query: String,
) -> Result<FileMatches, AppError> {
    if query.is_empty() {
        return Ok(FileMatches::default());
    }
    on_folder("search_files", app, folder_id, Start::Never, move |on| {
        let found = on.reader.search_files(&on.info, &query).unwrap_or_default();
        Ok(search::note_files(found))
    })
    .await
}

#[tauri::command]
/// Stops the search in contents going on: the palette closed.
pub(crate) fn stop_content_search(projects: tauri::State<'_, Projects>) {
    projects.stop_content_search();
}

#[tauri::command]
/// The names that match `query`, best first, by their index: the Move dialog's projects and lists.
/// A few names, ranked at once on the async runtime.
pub(crate) async fn rank_names(query: String, names: Vec<String>) -> Vec<usize> {
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    search::rank_names(&query, &names)
}
