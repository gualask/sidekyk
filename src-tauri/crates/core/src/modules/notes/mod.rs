//! Notes: plain-text cards in lists, a book of them per project and one for the Inbox, kept by the
//! app (never in a repository), one file per note. Where the files are belongs to the layers
//! around it (`NotesStorage`).

mod book;
mod contracts;
mod markdown;
mod ports;
mod store;

pub use book::note_title;
pub use contracts::{
    Book, BookTarget, DeletedList, ListTarget, MovedList, MovedNote, Note, NoteList, NotesSummary,
    ProjectNotes, INBOX_BOOK,
};
pub use markdown::{to_markdown, ExportWords};
pub use ports::NotesStorage;
pub use store::NotesStore;
