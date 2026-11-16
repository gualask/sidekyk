//! The palette across the project list: the projects, the panels, the files of the folder on
//! screen and the notes of the books (`docs/features/search.md`).

use super::machines::Start;
use super::notes::project_book;
use super::projects::Projects;
use crate::modules::notes::{Book, NotesStorage, NotesStore};
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
