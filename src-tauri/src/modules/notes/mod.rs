//! A project's notes: plain-text cards in lists, kept by the app (never in the repository), one
//! file per note. Where the files are belongs to the layers around it (`NotesStorage`).

mod book;
mod contracts;
mod markdown;
mod ports;
mod store;

pub(crate) use contracts::{DeletedList, Note, NoteList, ProjectNotes};
pub(crate) use markdown::to_markdown;
pub(crate) use ports::NotesStorage;
pub(crate) use store::NotesStore;
