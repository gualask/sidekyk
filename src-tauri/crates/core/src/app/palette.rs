//! The palette and what a note names, across the project list: the projects, the panels, the
//! files of the folder on screen and the notes of the books, and the folders that hold a file a
//! note names (`docs/features/search.md`, `note-references.md`).

use super::machines::Start;
use super::notes::project_book;
use super::projects::Projects;
use crate::modules::notes::{Book, NotesStorage, NotesStore};
use crate::modules::projects::ProjectFolder;
use crate::modules::search::{self, search_every_book, search_notes, SearchRequest, SearchResults};

/// What was typed in the palette, ranked against the projects and the note lists and notes of the
/// Inbox and every project at all projects, or the panels and the files, note lists and notes of
/// the project on screen. The files are the folder on screen's alone, when it is the project asked
/// for's, ranked where its files are kept: none while its WSL distro is stopped, which only its
/// Start button starts. Git runs only to list the files, when its tree is not read yet; the notes
/// are read from disk only when not already in memory; a book that does not read gives none.
pub fn search(
    projects: &Projects,
    store: &NotesStore,
    storage: &dyn NotesStorage,
    request: &SearchRequest,
) -> SearchResults {
    let list = projects.list();
    let on_screen = projects.folder_on_screen();
    let query = request.query.as_str();
    let files_of = |id: &str| {
        let (_, folder) = on_screen.as_ref().filter(|(p, _)| p.id == id)?;
        let on = projects.reader(&folder.id, Start::Never).ok()?;
        on.reader.search_files(&on.info, query)
    };
    let notes_of = |id: &str| {
        let project = list.find(id).ok()?;
        store
            .with_notes(storage, &project_book(project), |lists, found| {
                search_notes(query, &project.id, lists, found)
            })
            .inspect_err(
                |error| tracing::debug!(error = %format!("{error:#}"), "no notes to search"),
            )
            .ok()
    };
    let every_notes = || {
        // the Inbox first: equal scores keep the books' order
        let books: Vec<Book> = std::iter::once(Book::Inbox)
            .chain(list.projects.iter().map(project_book))
            .collect();
        store.with_every_book(storage, &books, |found| search_every_book(query, found))
    };
    search::search(request, &list.projects, files_of, notes_of, every_notes)
}

/// The folders of a project whose tree holds `path`, a file a note names: only `first`, the
/// folder on screen, when it does (its cached tree, which its watcher keeps fresh); else the
/// others that do, in the project's order, their trees read again side by side and not kept.
/// A path outside a tree (moved, deleted, ignored, through `..`) is in none; a folder that
/// cannot be read, or only by starting its WSL distro, is left out.
pub fn folders_holding(
    projects: &Projects,
    project_id: &str,
    first: Option<&str>,
    path: &str,
) -> anyhow::Result<Vec<String>> {
    let project = projects.project(project_id)?;
    let first = first.and_then(|id| project.folders.iter().find(|f| f.id == id));
    let on_screen_holds = |folder: &ProjectFolder| {
        projects
            .reader(&folder.id, Start::Never)
            .and_then(|on| on.reader.file_stamp(&on.info, path))
            .is_ok()
    };
    if let Some(folder) = first.filter(|f| on_screen_holds(f)) {
        return Ok(vec![folder.id.clone()]);
    }
    let holds = |folder: &ProjectFolder| {
        projects
            .reader(&folder.id, Start::Never)
            .and_then(|on| on.reader.tree_holds_now(&on.info, path))
            .unwrap_or(false)
    };
    let others: Vec<&ProjectFolder> = project
        .folders
        .iter()
        .filter(|f| first.is_none_or(|first| first.id != f.id))
        .collect();
    let held: Vec<bool> = std::thread::scope(|scope| {
        let checks: Vec<_> = others
            .iter()
            .map(|folder| scope.spawn(|| holds(folder)))
            .collect();
        checks
            .into_iter()
            .map(|check| check.join().unwrap_or(false))
            .collect()
    });
    Ok(others
        .into_iter()
        .zip(held)
        .filter(|(_, held)| *held)
        .map(|(folder, _)| folder.id.clone())
        .collect())
}
