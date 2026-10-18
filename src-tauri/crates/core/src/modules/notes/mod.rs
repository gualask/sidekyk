//! A project's notes: plain-text cards in lists, kept by the app (never in the repository), one
//! file per note. Where the files are belongs to the layers around it (`NotesStorage`).

mod book;
mod contracts;
mod markdown;
mod ports;
mod store;

pub use book::note_title;
pub use contracts::{DeletedList, Note, NoteList, NotesSummary, ProjectNotes};
pub use markdown::to_markdown;
pub use ports::NotesStorage;
pub use store::NotesStore;
