//! Every book's notes on disk: one folder per book, one file per note, so a change writes one
//! small file and two machines syncing them clash only on the same note.
//!
//! What the files are and how they are read and written: `files`; a book read: `books`.
//!
//! Every book read stays in memory until the app quits or the book is deleted: every change goes
//! to it, then at once to its files, which are read again only after a write failed.
//!
//! An image's files outlive its note until the book is first read in the next session, so an undo
//! finds them; a note moved to another book takes copies of them.

mod books;
mod capture;
mod images;
mod lists;
mod notes;

pub use capture::{CaptureImage, CaptureWrite};

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use super::book::{NoteBook, Touched};
use super::contracts::{Book, Note, NoteList, NotesCount, ProjectNotes};
use super::files::write_touched;
use super::ports::NotesStorage;
use crate::shared::sync::lock;

/// The list a book starts with, until `name_first_lists` names it in the UI's language.
const FIRST_LIST_NAME: &str = "General";
/// The id of a book's first list: the same each time a book with nothing written is read, so the
/// list the frontend was given is still there when it writes.
const FIRST_LIST_ID: &str = "0000000000000000";
/// The Inbox's folder: never a project's, whose names end in `-` and 6 hex digits.
const INBOX_FOLDER: &str = "inbox";
/// Milliseconds since the Unix epoch.
pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// What only a project's book has: the Inbox has one list, never changed, and no done.
pub(super) fn project_only(book: &Book, what: &str) -> anyhow::Result<()> {
    anyhow::ensure!(!matches!(book, Book::Inbox), "the Inbox has no {what}");
    Ok(())
}

pub(super) struct KeptBook {
    /// `None` until something of the book is written.
    pub(super) folder: Option<String>,
    pub(super) notes: NoteBook,
    /// Mended on reading, written with the next change.
    pending: Vec<Touched>,
}

/// A book's lists and notes, where the store keeps them (`with_every_book`).
pub struct BookNotes<'a> {
    pub book: &'a Book,
    pub lists: &'a [NoteList],
    pub notes: &'a [Note],
}

/// Every book's notes, through the storage given to each call.
#[derive(Default)]
pub struct NotesStore {
    /// Which folder holds each project's notes, by project id: read once.
    folders: Mutex<Option<HashMap<String, String>>>,
    /// Every book read, by key: notes change only through here, so they stay until the app quits
    /// or the book is deleted.
    pub(super) books: Mutex<HashMap<String, KeptBook>>,
    /// The name of a book's first list, `FIRST_LIST_NAME` until named.
    first_list_name: Mutex<Option<&'static str>>,
    /// The books refused this session (`NotesUnreadable`), by key, with why: each refused once,
    /// not read again at every look (the palette's, at each key).
    refused: Mutex<HashMap<String, String>>,
    /// The books whose images of no note were removed this session, by key: once, at the first
    /// read, so an undo of this session finds its files.
    swept: Mutex<HashSet<String>>,
}

impl NotesStore {
    /// Names the list a book starts with from now on; lists already there keep theirs.
    pub fn name_first_lists(&self, name: &'static str) {
        *lock(&self.first_list_name) = Some(name);
    }

    /// A book's notes in memory, read first when they are not.
    pub(super) fn kept_book<'a>(
        &self,
        books: &'a mut HashMap<String, KeptBook>,
        storage: &dyn NotesStorage,
        book: &Book,
    ) -> anyhow::Result<&'a mut KeptBook> {
        if !books.contains_key(book.key()) {
            let kept = self.read_book(storage, book)?;
            books.insert(book.key().into(), kept);
        }
        Ok(books.get_mut(book.key()).expect("just read"))
    }

    /// Looks at a book's notes in memory, read first when they are not.
    pub(super) fn with_book<T>(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        look: impl FnOnce(&NoteBook) -> T,
    ) -> anyhow::Result<T> {
        let mut books = lock(&self.books);
        Ok(look(&self.kept_book(&mut books, storage, book)?.notes))
    }

    /// Runs a change on a book's notes, then writes what it touched. A failed write drops the
    /// book from memory: the next call reads its files.
    pub(super) fn change<T>(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        change: impl FnOnce(&mut NoteBook) -> anyhow::Result<(T, Vec<Touched>)>,
    ) -> anyhow::Result<T> {
        self.change_kept(storage, book, |kept| change(&mut kept.notes))
    }

    /// `change`, given the book as kept (its folder too): a change that writes files of its own
    /// before the notes, which fails with the notes in memory as they were.
    pub(super) fn change_kept<T>(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        change: impl FnOnce(&mut KeptBook) -> anyhow::Result<(T, Vec<Touched>)>,
    ) -> anyhow::Result<T> {
        let mut books = lock(&self.books);
        let kept = self.kept_book(&mut books, storage, book)?;
        let (value, touched) = change(kept)?;
        if let Err(error) = self.write(storage, book, kept, touched) {
            books.remove(book.key());
            return Err(error);
        }
        Ok(value)
    }

    /// Runs a change that moves notes from `giver` to `taker`, two books, and writes `taker`'s
    /// files first: a failure between leaves notes in both, never in neither. A failure drops
    /// both books from memory.
    pub(super) fn exchange<T>(
        &self,
        storage: &dyn NotesStorage,
        giver: &Book,
        taker: &Book,
        change: impl FnOnce(
            &mut NoteBook,
            &mut NoteBook,
        ) -> anyhow::Result<(T, Vec<Touched>, Vec<Touched>)>,
    ) -> anyhow::Result<T> {
        anyhow::ensure!(giver.key() != taker.key(), "notes move to another book");
        let mut books = lock(&self.books);
        let result = self.exchange_in(&mut books, storage, giver, taker, change);
        if result.is_err() {
            books.remove(giver.key());
            books.remove(taker.key());
        }
        result
    }

    fn exchange_in<T>(
        &self,
        books: &mut HashMap<String, KeptBook>,
        storage: &dyn NotesStorage,
        giver: &Book,
        taker: &Book,
        change: impl FnOnce(
            &mut NoteBook,
            &mut NoteBook,
        ) -> anyhow::Result<(T, Vec<Touched>, Vec<Touched>)>,
    ) -> anyhow::Result<T> {
        self.kept_book(books, storage, giver)?;
        self.kept_book(books, storage, taker)?;
        let [Some(giving), Some(taking)] = books.get_disjoint_mut([giver.key(), taker.key()])
        else {
            unreachable!("both just read");
        };
        let (value, gave, took) = change(&mut giving.notes, &mut taking.notes)?;
        self.carry_images(storage, taker, taking, giving.folder.as_deref(), &took)?;
        self.write(storage, taker, taking, took)?;
        self.write(storage, giver, giving, gave)?;
        Ok(value)
    }

    /// Writes what a change touched, if anything, with what reading mended.
    fn write(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        kept: &mut KeptBook,
        mut touched: Vec<Touched>,
    ) -> anyhow::Result<()> {
        if touched.is_empty() {
            return Ok(());
        }
        let folder = self.folder(storage, book, kept)?;
        touched.append(&mut kept.pending);
        let mut seen = HashSet::new();
        touched.retain(|t| seen.insert(t.clone()));
        for touched in touched {
            write_touched(storage, &folder, &kept.notes, touched)?;
        }
        Ok(())
    }

    /// A book's notes; none written yet is a first, empty list.
    pub fn notes(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<ProjectNotes> {
        self.with_book(storage, book, NoteBook::snapshot)
    }

    /// How many notes a book has, open and done.
    pub fn count(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<NotesCount> {
        self.with_book(storage, book, NoteBook::count)
    }

    /// Deletes a project's notes, its folder with them: the project goes. The Inbox stays.
    pub fn delete_book(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<()> {
        anyhow::ensure!(!matches!(book, Book::Inbox), "the Inbox is never deleted");
        let mut books = lock(&self.books);
        if let Some(folder) = self.folder_of(storage, book)? {
            storage.remove_folder(&folder)?;
        }
        if let Some(found) = lock(&self.folders).as_mut() {
            found.remove(book.key());
        }
        books.remove(book.key());
        lock(&self.refused).remove(book.key());
        Ok(())
    }

    /// Looks at a book's lists and notes where they are kept, without a copy: the palette
    /// searches them at every key, an export writes them.
    pub fn with_notes<T>(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        look: impl FnOnce(&[NoteList], &[Note]) -> T,
    ) -> anyhow::Result<T> {
        self.with_book(storage, book, |notes| look(&notes.lists, &notes.notes))
    }

    /// Looks at the lists and notes of every book named where they are kept, reading those that
    /// are not: the palette at all projects searches them at every key. A book that cannot be
    /// read is left out.
    pub fn with_every_book<T>(
        &self,
        storage: &dyn NotesStorage,
        books: &[Book],
        look: impl FnOnce(&[BookNotes]) -> T,
    ) -> T {
        let mut kept = lock(&self.books);
        for book in books {
            if let Err(error) = self.kept_book(&mut kept, storage, book) {
                tracing::debug!(book = book.key(), error = %format!("{error:#}"), "notes not read");
            }
        }
        let found: Vec<BookNotes> = books
            .iter()
            .filter_map(|book| {
                let notes = &kept.get(book.key())?.notes;
                Some(BookNotes {
                    book,
                    lists: &notes.lists,
                    notes: &notes.notes,
                })
            })
            .collect();
        look(&found)
    }
}

#[cfg(test)]
pub mod tests {
    use super::super::contracts::{DeletedList, ListTarget};
    use super::super::files::{note_file, project_of, LISTS_FILE, PROJECT_FILE, STATE_FILE};
    use super::*;
    use crate::modules::notes::contracts::STORED_VERSION;
    use crate::modules::notes::INBOX_BOOK;
    use crate::shared::error::{user_facing_code, UserFacingErrorCode};
    use crate::shared::id::{is_id, new_id};
    use std::collections::BTreeMap;
    use std::sync::atomic::Ordering;

    /// Folders of files in memory; `fail_writes` makes every write fail, `reads` counts the
    /// folders listed and the files read.
    #[derive(Default)]
    pub struct MemoryStorage {
        pub files: Mutex<BTreeMap<(String, String), Vec<u8>>>,
        pub fail_writes: std::sync::atomic::AtomicBool,
        pub reads: std::sync::atomic::AtomicUsize,
    }

    impl NotesStorage for MemoryStorage {
        fn folders(&self) -> anyhow::Result<Vec<String>> {
            let mut folders: Vec<String> =
                lock(&self.files).keys().map(|(f, _)| f.clone()).collect();
            folders.dedup();
            Ok(folders)
        }

        fn files(&self, folder: &str) -> anyhow::Result<Vec<String>> {
            self.reads.fetch_add(1, Ordering::Relaxed);
            Ok(lock(&self.files)
                .keys()
                .filter(|(f, _)| f == folder)
                .map(|(_, name)| name.clone())
                .collect())
        }

        fn read(&self, folder: &str, file: &str, limit: u64) -> anyhow::Result<Option<Vec<u8>>> {
            self.reads.fetch_add(1, Ordering::Relaxed);
            let files = lock(&self.files);
            let Some(bytes) = files.get(&(folder.into(), file.into())) else {
                return Ok(None);
            };
            anyhow::ensure!(bytes.len() as u64 <= limit, "too long");
            Ok(Some(bytes.clone()))
        }

        fn write(&self, folder: &str, file: &str, bytes: &[u8]) -> anyhow::Result<()> {
            anyhow::ensure!(!self.fail_writes.load(Ordering::Relaxed), "disk full");
            lock(&self.files).insert((folder.into(), file.into()), bytes.to_vec());
            Ok(())
        }

        fn remove(&self, folder: &str, file: &str) -> anyhow::Result<()> {
            lock(&self.files).remove(&(folder.into(), file.into()));
            Ok(())
        }

        fn remove_folder(&self, folder: &str) -> anyhow::Result<()> {
            lock(&self.files).retain(|(f, _), _| f != folder);
            Ok(())
        }

        fn location(&self, folder: &str, file: &str) -> anyhow::Result<String> {
            Ok(format!("/data/notes/{folder}/{file}"))
        }
    }

    impl MemoryStorage {
        pub(crate) fn names(&self) -> Vec<(String, String)> {
            lock(&self.files).keys().cloned().collect()
        }

        /// What was read since the last call.
        fn reads(&self) -> usize {
            self.reads.swap(0, Ordering::Relaxed)
        }
    }

    pub(crate) const SHOP: &str = "/dev/shop";

    pub(crate) fn project(id: &str, name: &str) -> Book {
        Book::Project {
            id: id.into(),
            name: name.into(),
        }
    }

    pub(crate) fn shop() -> Book {
        project(SHOP, "shop")
    }

    pub(crate) fn docs() -> Book {
        project("/dev/docs", "docs")
    }

    #[test]
    fn reading_a_project_without_notes_writes_nothing() {
        let storage = MemoryStorage::default();
        let notes = NotesStore::default().notes(&storage, &shop()).unwrap();
        assert_eq!(notes.lists.len(), 1);
        assert_eq!(notes.lists[0].name, "General");
        assert!(notes.notes.is_empty());
        assert!(storage.names().is_empty());
    }

    #[test]
    fn the_first_list_takes_the_name_given() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        store.name_first_lists("Generale");
        assert_eq!(
            store.notes(&storage, &shop()).unwrap().lists[0].name,
            "Generale"
        );
    }

    #[test]
    fn the_first_note_writes_the_project_its_lists_and_itself() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &general, "Try the rail".into())
            .unwrap();

        let names = storage.names();
        let folder = &names[0].0;
        assert!(folder.starts_with("shop-"), "{folder}");
        let files: Vec<&str> = names.iter().map(|(_, f)| f.as_str()).collect();
        assert_eq!(
            files,
            [note_file(&note.id).as_str(), LISTS_FILE, PROJECT_FILE]
        );
        let project = project_of(&storage, folder).unwrap();
        assert_eq!(project.id, SHOP);
    }

    #[test]
    fn a_folder_named_by_its_root_before_ids_still_holds_its_project() {
        let storage = MemoryStorage::default();
        storage
            .write(
                "shop-3f9a2c",
                PROJECT_FILE,
                br#"{ "version": 1, "root": "/dev/shop" }"#,
            )
            .unwrap();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        store
            .add_note(&storage, &shop(), &list, "a".into())
            .unwrap();
        assert!(storage
            .names()
            .iter()
            .all(|(folder, _)| folder == "shop-3f9a2c"));
    }

    #[test]
    fn notes_come_back_from_their_files() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let first = store
            .add_note(&storage, &shop(), &general, "a".into())
            .unwrap();
        store
            .set_note_done(&storage, &shop(), &first.id, true)
            .unwrap();
        let release = store.add_list(&storage, &shop(), "Release").unwrap();
        store
            .add_note(&storage, &shop(), &release.id, "b".into())
            .unwrap();

        let written = store.notes(&storage, &shop()).unwrap();
        let mut read = NotesStore::default().notes(&storage, &shop()).unwrap();
        let mut expected = written.clone();
        read.notes.sort_by(|a, b| a.id.cmp(&b.id));
        expected.notes.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(read, expected);
        assert_eq!(read.open_list, release.id);
        assert_eq!(read.lists[0].id, general);
    }

    #[test]
    fn each_project_keeps_its_own_folder() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        for book in [shop(), docs()] {
            let list = store.notes(&storage, &book).unwrap().open_list;
            store
                .add_note(&storage, &book, &list, book.key().into())
                .unwrap();
        }
        assert_eq!(storage.folders().unwrap().len(), 2);
        let fresh = NotesStore::default();
        assert_eq!(fresh.notes(&storage, &shop()).unwrap().notes[0].text, SHOP);
        assert_eq!(
            fresh.notes(&storage, &docs()).unwrap().notes[0].text,
            "/dev/docs"
        );
    }

    #[test]
    fn a_deleted_note_leaves_no_file() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &list, "a".into())
            .unwrap();
        store.delete_note(&storage, &shop(), &note.id).unwrap();
        assert!(!storage
            .names()
            .iter()
            .any(|(_, file)| *file == note_file(&note.id)));
    }

    #[test]
    fn a_failed_write_reads_the_files_again() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &list, "a".into())
            .unwrap();
        storage.fail_writes.store(true, Ordering::Relaxed);
        assert!(store
            .set_note_text(&storage, &shop(), &note.id, "b".into())
            .is_err());
        storage.fail_writes.store(false, Ordering::Relaxed);
        assert_eq!(store.notes(&storage, &shop()).unwrap().notes[0].text, "a");
    }

    /// A book with a note written, and its folder.
    pub(crate) fn book_with_a_note() -> (MemoryStorage, String) {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        store
            .add_note(&storage, &shop(), &list, "a".into())
            .unwrap();
        let folder = storage.folders().unwrap().remove(0);
        (storage, folder)
    }

    pub(crate) fn refused(result: anyhow::Result<impl std::fmt::Debug>) -> bool {
        user_facing_code(&result.unwrap_err()) == Some(UserFacingErrorCode::NotesUnreadable)
    }

    #[test]
    fn a_book_with_a_file_that_does_not_read_is_refused_and_never_written() {
        for (file, text) in [
            ("0123456789abcdef.json", &b"{ not json"[..]),
            (LISTS_FILE, b"{ \"version\": 1, \"lists\": [ {"),
            (
                LISTS_FILE,
                br#"{ "version": 1, "lists": [{ "id": "x", "name": "Bugs" }] }"#,
            ),
        ] {
            let (storage, folder) = book_with_a_note();
            storage.write(&folder, file, text).unwrap();
            let before = lock(&storage.files).clone();
            let store = NotesStore::default();
            assert!(refused(store.notes(&storage, &shop())), "{file}");
            assert!(refused(store.add_note(
                &storage,
                &shop(),
                FIRST_LIST_ID,
                "b".into()
            )));
            assert_eq!(*lock(&storage.files), before, "{file}");
        }
    }

    #[test]
    fn a_book_a_newer_version_wrote_is_refused() {
        let (storage, folder) = book_with_a_note();
        let note = storage
            .names()
            .into_iter()
            .find(|(_, file)| is_id(file.trim_end_matches(".json")))
            .unwrap()
            .1;
        let mut json: serde_json::Value =
            serde_json::from_slice(&storage.read(&folder, &note, 1 << 20).unwrap().unwrap())
                .unwrap();
        json["version"] = (STORED_VERSION + 1).into();
        json["pinned"] = true.into();
        storage
            .write(&folder, &note, &serde_json::to_vec(&json).unwrap())
            .unwrap();
        let store = NotesStore::default();
        assert!(refused(store.notes(&storage, &shop())));
        // refused once: not read again at the next look, nor by the palette
        storage.reads();
        assert!(refused(store.count(&storage, &shop())));
        store.with_every_book(&storage, &[shop()], |found| assert!(found.is_empty()));
        assert_eq!(storage.reads(), 0);
    }

    #[test]
    fn a_list_open_that_does_not_read_opens_the_first() {
        let (storage, folder) = book_with_a_note();
        storage.write(&folder, STATE_FILE, b"{ broken").unwrap();
        let notes = NotesStore::default().notes(&storage, &shop()).unwrap();
        assert_eq!(notes.open_list, FIRST_LIST_ID);
        assert_eq!(notes.notes.len(), 1);
    }

    /// Two books with a note each, written by another store: on disk, none in memory.
    pub(crate) fn two_books_on_disk() -> MemoryStorage {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        for book in [shop(), docs()] {
            let list = store.notes(&storage, &book).unwrap().open_list;
            store.add_note(&storage, &book, &list, "a".into()).unwrap();
        }
        storage.reads();
        storage
    }

    #[test]
    fn every_book_read_stays_in_memory() {
        let storage = two_books_on_disk();
        let store = NotesStore::default();
        // every book read once
        for book in [shop(), docs()] {
            assert_eq!(store.count(&storage, &book).unwrap().open, 1);
        }
        assert!(storage.reads() > 0);
        // a project switch, an export, the palette, a removal's count: no file read again
        store.notes(&storage, &shop()).unwrap();
        store.notes(&storage, &docs()).unwrap();
        store.with_notes(&storage, &shop(), |_, _| ()).unwrap();
        assert_eq!(store.count(&storage, &docs()).unwrap().open, 1);
        assert_eq!(storage.reads(), 0);
    }

    #[test]
    fn a_count_comes_from_the_notes_changed() {
        let storage = two_books_on_disk();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        store
            .add_note(&storage, &shop(), &list, "b".into())
            .unwrap();
        store.notes(&storage, &docs()).unwrap();
        assert_eq!(store.count(&storage, &shop()).unwrap().open, 2);
    }

    #[test]
    fn a_failed_write_drops_that_book_only() {
        let storage = two_books_on_disk();
        let store = NotesStore::default();
        let note = store.notes(&storage, &shop()).unwrap().notes.remove(0);
        store.notes(&storage, &docs()).unwrap();
        storage.reads();
        storage.fail_writes.store(true, Ordering::Relaxed);
        assert!(store
            .set_note_text(&storage, &shop(), &note.id, "b".into())
            .is_err());
        storage.fail_writes.store(false, Ordering::Relaxed);
        store.notes(&storage, &docs()).unwrap();
        assert_eq!(storage.reads(), 0);
        assert_eq!(store.notes(&storage, &shop()).unwrap().notes[0].text, "a");
        assert!(storage.reads() > 0);
    }

    #[test]
    fn a_move_keeps_both_books_in_memory() {
        let storage = two_books_on_disk();
        let store = NotesStore::default();
        let note = store.notes(&storage, &shop()).unwrap().notes.remove(0);
        store
            .move_note(&storage, &shop(), &note.id, &docs(), ListTarget::Open)
            .unwrap();
        storage.reads();
        assert!(store.notes(&storage, &shop()).unwrap().notes.is_empty());
        assert_eq!(store.notes(&storage, &docs()).unwrap().notes.len(), 2);
        assert_eq!(storage.reads(), 0);
    }

    #[test]
    fn every_book_is_looked_at_reading_only_those_missing() {
        let storage = two_books_on_disk();
        let store = NotesStore::default();
        store.notes(&storage, &shop()).unwrap();
        storage.reads();
        let books = [shop(), docs(), Book::Inbox];
        let seen = store.with_every_book(&storage, &books, |found| {
            found
                .iter()
                .map(|b| (b.book.key().to_owned(), b.notes.len()))
                .collect::<Vec<_>>()
        });
        assert_eq!(
            seen,
            [
                (SHOP.into(), 1),
                ("/dev/docs".into(), 1),
                (INBOX_BOOK.into(), 0)
            ]
        );
        // docs' folder listed and its files read, the Inbox's folder listed
        assert!(storage.reads() > 0);
        store.with_every_book(&storage, &books, |_| ());
        assert_eq!(storage.reads(), 0);
    }

    #[test]
    fn a_project_deleted_leaves_nothing_and_counts_none() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        store
            .add_note(&storage, &shop(), &list, "a".into())
            .unwrap();
        store
            .add_note(&storage, &shop(), &list, "b".into())
            .unwrap();
        assert_eq!(store.count(&storage, &shop()).unwrap().open, 2);
        assert_eq!(
            store
                .count(&storage, &project("/dev/other", "other"))
                .unwrap()
                .open,
            0
        );

        store.delete_book(&storage, &shop()).unwrap();
        assert!(storage.names().is_empty());
        // gone from memory too
        assert_eq!(store.count(&storage, &shop()).unwrap().open, 0);
        // added again, it starts with none
        assert!(store.notes(&storage, &shop()).unwrap().notes.is_empty());
    }

    #[test]
    fn a_new_folder_never_takes_one_in_use() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        // two projects of the same name
        for book in [project("/a/shop", "shop"), project("/b/shop", "shop")] {
            let list = store.notes(&storage, &book).unwrap().open_list;
            store.add_note(&storage, &book, &list, "a".into()).unwrap();
        }
        assert_eq!(storage.folders().unwrap().len(), 2);
    }

    #[test]
    fn a_note_file_names_its_note() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &list, "a".into())
            .unwrap();
        let folder = storage.folders().unwrap().remove(0);
        // a copy under another name, as a sync conflict could leave
        let bytes = storage
            .read(&folder, &note_file(&note.id), 1 << 20)
            .unwrap()
            .unwrap();
        storage
            .write(&folder, "00000000000000ff.json", &bytes)
            .unwrap();
        let ids: HashSet<String> = NotesStore::default()
            .notes(&storage, &shop())
            .unwrap()
            .notes
            .into_iter()
            .map(|n| n.id)
            .collect();
        assert_eq!(ids, HashSet::from([note.id, "00000000000000ff".into()]));
    }

    /// The texts of a book's open notes in a list, from the top.
    pub(crate) fn texts(
        store: &NotesStore,
        storage: &MemoryStorage,
        book: &Book,
        list: &str,
    ) -> Vec<String> {
        let mut notes: Vec<Note> = store
            .notes(storage, book)
            .unwrap()
            .notes
            .into_iter()
            .filter(|n| n.list == list && n.done.is_none())
            .collect();
        notes.sort_by(|a, b| a.position.total_cmp(&b.position));
        notes.into_iter().map(|n| n.text).collect()
    }

    pub(crate) fn list_named(
        store: &NotesStore,
        storage: &MemoryStorage,
        book: &Book,
        name: &str,
    ) -> String {
        let notes = store.notes(storage, book).unwrap();
        notes.lists.into_iter().find(|l| l.name == name).unwrap().id
    }

    #[test]
    fn the_inbox_keeps_its_notes_in_a_folder_of_its_own() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &Book::Inbox).unwrap().open_list;
        store
            .add_note(&storage, &Book::Inbox, &list, "milk".into())
            .unwrap();
        let names = storage.names();
        assert!(names.iter().all(|(folder, _)| folder == INBOX_FOLDER));
        assert!(!names.iter().any(|(_, file)| file == PROJECT_FILE));
        let fresh = NotesStore::default();
        assert_eq!(
            fresh.notes(&storage, &Book::Inbox).unwrap().notes[0].text,
            "milk"
        );
        assert!(fresh.notes(&storage, &shop()).unwrap().notes.is_empty());
    }

    #[test]
    fn the_inbox_refuses_what_only_projects_have() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let inbox = &Book::Inbox;
        let list = store.notes(&storage, inbox).unwrap().open_list;
        let note = store.add_note(&storage, inbox, &list, "a".into()).unwrap();
        let deleted = DeletedList {
            list: NoteList {
                id: new_id(),
                name: "x".into(),
            },
            index: 0,
            notes: Vec::new(),
        };
        assert!(store.add_list(&storage, inbox, "x").is_err());
        assert!(store.rename_list(&storage, inbox, &list, "x").is_err());
        assert!(store.delete_list(&storage, inbox, &list).is_err());
        assert!(store.restore_list(&storage, inbox, deleted).is_err());
        assert!(store.open_list(&storage, inbox, &list).is_err());
        assert!(store
            .set_note_done(&storage, inbox, &note.id, true)
            .is_err());
        assert!(store
            .place_note(&storage, inbox, &note.id, &list, 0)
            .is_err());
        assert!(store.delete_book(&storage, inbox).is_err());
        assert!(store.move_list(&storage, inbox, &list, &shop()).is_err());
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let other = store
            .add_note(&storage, &shop(), &general, "b".into())
            .unwrap();
        let into_list = ListTarget::List { id: list.clone() };
        assert!(store
            .move_note(&storage, &shop(), &other.id, inbox, into_list)
            .is_err());
        assert!(store.move_list(&storage, &shop(), &general, inbox).is_err());
        // nothing of it was taken
        assert_eq!(store.notes(&storage, inbox).unwrap().notes, [note]);
    }

    #[test]
    fn a_book_with_nothing_written_keeps_its_first_list() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &Book::Inbox).unwrap().open_list;
        // the first write fails: the Inbox, still without files, is read again
        storage.fail_writes.store(true, Ordering::Relaxed);
        assert!(store
            .add_note(&storage, &Book::Inbox, &list, "a".into())
            .is_err());
        storage.fail_writes.store(false, Ordering::Relaxed);
        store
            .add_note(&storage, &Book::Inbox, &list, "a".into())
            .unwrap();
    }
}
