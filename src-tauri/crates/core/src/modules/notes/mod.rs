//! Notes: plain-text cards in lists, a book of them per project and one for the Inbox, kept by the
//! app (never in a repository), one file per note. Where the files are belongs to the layers
//! around it (`NotesStorage`).

mod book;
mod contracts;
mod images;
mod markdown;
mod ports;
mod store;

pub use book::note_title;
pub use contracts::{
    Book, DeletedList, ImageKind, ImageTarget, ListTarget, Mark, MarkPoint, MarkedImage, MovedList,
    MovedNote, Note, NoteImage, NoteList, NotesCount, ProjectNotes, SourceImage, INBOX_BOOK,
};
pub use images::{
    as_png, given_images, image_file, prepare, prepare_capture, PreparedImage, MAX_IMAGE_BYTES,
};
pub use markdown::{to_markdown, ExportWords, EXPORT_IMAGES};
pub use ports::{GivenFiles, NotesStorage};
pub use store::{BookNotes, NotesStore};
