//! The store's changes to a book's notes: adding, editing, placing, deleting and moving them.

use super::lists::new_list_id;
use super::{now, project_only, NotesStore};
use crate::modules::notes::book::NoteBook;
use crate::modules::notes::contracts::{Book, ListTarget, MovedNote, Note};
use crate::modules::notes::ports::NotesStorage;
use crate::shared::id::new_id;

/// A new id no note of `book` has.
pub(super) fn new_note_id(book: &NoteBook) -> String {
    let mut id = new_id();
    while book.note(&id).is_some() {
        id = new_id();
    }
    id
}

impl NotesStore {
    pub fn add_note(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        list: &str,
        text: String,
    ) -> anyhow::Result<Note> {
        self.change(storage, book, |notes| {
            notes.add(new_note_id(notes), list, text, now())
        })
    }

    pub fn set_note_text(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
        text: String,
    ) -> anyhow::Result<Note> {
        self.change(storage, book, |notes| notes.set_text(id, text, now()))
    }

    pub fn set_note_done(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
        done: bool,
    ) -> anyhow::Result<Note> {
        project_only(book, "done")?;
        self.change(storage, book, |notes| notes.set_done(id, done, now()))
    }

    /// Moves a note to `index` among the open notes of `list`; the notes whose place changed come
    /// back.
    pub fn place_note(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
        list: &str,
        index: usize,
    ) -> anyhow::Result<Vec<Note>> {
        project_only(book, "order")?;
        self.change(storage, book, |notes| notes.place(id, list, index))
    }

    pub fn restore_note(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        note: Note,
    ) -> anyhow::Result<Note> {
        self.change(storage, book, |notes| notes.restore(note))
    }

    pub fn delete_note(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
    ) -> anyhow::Result<()> {
        self.change(storage, book, |notes| Ok(((), notes.delete(id)?)))
    }

    /// Moves a note to another book, or to another list of its own, keeping its id: on top of
    /// the list's open notes. A done note stays done, but in the Inbox, which has no done.
    pub fn move_note(
        &self,
        storage: &dyn NotesStorage,
        from: &Book,
        id: &str,
        to: &Book,
        list: ListTarget,
    ) -> anyhow::Result<MovedNote> {
        let reopen = matches!(to, Book::Inbox);
        if reopen {
            anyhow::ensure!(list == ListTarget::Open, "the Inbox has one list");
        }
        let note = if from.key() == to.key() {
            self.change(storage, from, |notes| {
                let note = notes.find(id)?.clone();
                notes.receive(note, list, new_list_id(notes), reopen)
            })?
        } else {
            self.exchange(storage, from, to, |giving, taking| {
                let note = giving.find(id)?.clone();
                let new_list = new_list_id(taking);
                let (note, took) = taking.receive(note, list, new_list, reopen)?;
                Ok((note, giving.take_out(id), took))
            })?
        };
        Ok(MovedNote {
            to: to.key().into(),
            note,
        })
    }

    /// Puts a moved note back in `home` as `original` was, and takes it out of `at` (undo).
    pub fn unmove_note(
        &self,
        storage: &dyn NotesStorage,
        at: &Book,
        original: Note,
        home: &Book,
    ) -> anyhow::Result<Note> {
        if at.key() == home.key() {
            return self.restore_note(storage, home, original);
        }
        let id = original.id.clone();
        self.exchange(storage, at, home, |giving, taking| {
            let (note, took) = taking.restore(original)?;
            Ok((note, giving.take_out(&id), took))
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use super::super::tests::*;
    use super::*;
    use crate::modules::notes::INBOX_BOOK;
    use crate::shared::error::{user_facing_code, UserFacingErrorCode};

    #[test]
    fn a_note_moves_between_books_keeping_its_id() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &general, "a".into())
            .unwrap();
        store
            .set_note_done(&storage, &shop(), &note.id, true)
            .unwrap();
        let inbox = store.notes(&storage, &Book::Inbox).unwrap().open_list;
        store
            .add_note(&storage, &Book::Inbox, &inbox, "b".into())
            .unwrap();

        // into the Inbox a done note opens again, on top
        let moved = store
            .move_note(&storage, &shop(), &note.id, &Book::Inbox, ListTarget::Open)
            .unwrap();
        assert_eq!(moved.to, INBOX_BOOK);
        assert_eq!(
            (moved.note.id.as_str(), moved.note.done),
            (note.id.as_str(), None)
        );
        assert_eq!(texts(&store, &storage, &Book::Inbox, &inbox), ["a", "b"]);
        assert!(store.notes(&storage, &shop()).unwrap().notes.is_empty());

        // into a project's new list
        let ideas = ListTarget::New {
            name: "Ideas".into(),
        };
        store
            .move_note(&storage, &Book::Inbox, &note.id, &docs(), ideas)
            .unwrap();
        let ideas = list_named(&store, &storage, &docs(), "Ideas");
        assert_eq!(texts(&store, &storage, &docs(), &ideas), ["a"]);
        assert_eq!(texts(&store, &storage, &Book::Inbox, &inbox), ["b"]);

        // a done note stays done between projects
        store
            .set_note_done(&storage, &docs(), &note.id, true)
            .unwrap();
        let moved = store
            .move_note(&storage, &docs(), &note.id, &shop(), ListTarget::Open)
            .unwrap();
        assert!(moved.note.done.is_some());
        assert_eq!(moved.note.list, general);

        // as read from the files
        let fresh = NotesStore::default();
        assert_eq!(fresh.notes(&storage, &shop()).unwrap().notes, [moved.note]);
        assert!(fresh.notes(&storage, &docs()).unwrap().notes.is_empty());
    }

    #[test]
    fn a_note_moves_into_a_list_of_another_book_named_by_id() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &general, "a".into())
            .unwrap();
        let release = store.add_list(&storage, &docs(), "Release").unwrap();
        store
            .add_note(&storage, &docs(), &release.id, "b".into())
            .unwrap();

        let gone = ListTarget::List { id: new_id() };
        let error = store
            .move_note(&storage, &shop(), &note.id, &docs(), gone)
            .unwrap_err();
        assert_eq!(
            user_facing_code(&error),
            Some(UserFacingErrorCode::NoteListMissing)
        );
        assert_eq!(
            store.notes(&storage, &shop()).unwrap().notes,
            std::slice::from_ref(&note)
        );

        let into = ListTarget::List {
            id: release.id.clone(),
        };
        store
            .move_note(&storage, &shop(), &note.id, &docs(), into)
            .unwrap();
        assert_eq!(texts(&store, &storage, &docs(), &release.id), ["a", "b"]);
        assert!(store.notes(&storage, &shop()).unwrap().notes.is_empty());
    }

    #[test]
    fn a_note_moves_to_another_list_of_its_book() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &general, "a".into())
            .unwrap();
        let release = ListTarget::New {
            name: "Release".into(),
        };
        let moved = store
            .move_note(&storage, &shop(), &note.id, &shop(), release)
            .unwrap();
        let notes = store.notes(&storage, &shop()).unwrap();
        assert_eq!(notes.notes, std::slice::from_ref(&moved.note));
        assert_eq!(notes.lists[1].id, moved.note.list);
        // the list open stays
        assert_eq!(notes.open_list, general);

        store
            .unmove_note(&storage, &shop(), note.clone(), &shop())
            .unwrap();
        assert_eq!(store.notes(&storage, &shop()).unwrap().notes, [note]);
    }

    #[test]
    fn an_undone_move_puts_the_note_back_as_it_was() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        for text in ["c", "b", "a"] {
            store
                .add_note(&storage, &shop(), &general, text.into())
                .unwrap();
        }
        let b = store.notes(&storage, &shop()).unwrap().notes[1].clone();
        let moved = store
            .move_note(&storage, &shop(), &b.id, &docs(), ListTarget::Open)
            .unwrap();
        store
            .unmove_note(&storage, &docs(), b.clone(), &shop())
            .unwrap();
        assert_eq!(texts(&store, &storage, &shop(), &general), ["a", "b", "c"]);
        assert!(store.notes(&storage, &docs()).unwrap().notes.is_empty());
        assert_eq!(moved.to, "/dev/docs");
    }

    #[test]
    fn a_move_that_cannot_be_written_leaves_the_note_where_it_was() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &general, "a".into())
            .unwrap();
        storage.fail_writes.store(true, Ordering::Relaxed);
        assert!(store
            .move_note(&storage, &shop(), &note.id, &docs(), ListTarget::Open)
            .is_err());
        storage.fail_writes.store(false, Ordering::Relaxed);
        assert_eq!(store.notes(&storage, &shop()).unwrap().notes, [note]);
        assert!(store.notes(&storage, &docs()).unwrap().notes.is_empty());
    }
}
