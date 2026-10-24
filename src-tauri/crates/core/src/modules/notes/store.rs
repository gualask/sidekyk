//! Every book's notes on disk: one folder per book, one file per note, so a change writes one
//! small file and two machines syncing them clash only on the same note.
//!
//! ```text
//! <folder>/project.json   { version, id }      the project's id (`root` before ids)
//! <folder>/lists.json     { version, lists: [{ id, name }] }   the user's order
//! <folder>/state.json     { version, openList }                this machine only
//! <folder>/<id>.json      { version, id, list, position, text, created, edited, done }
//! ```
//!
//! A project's folder is named after it; the Inbox's is `inbox`, without `project.json`.
//!
//! Every book read stays in memory until the app quits or the book is deleted: every change goes
//! to it, then at once to its files, which are read again only after a write failed.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::book::{NoteBook, Touched, MAX_NOTE_BYTES};
use super::contracts::{
    Book, DeletedList, ListTarget, MovedList, MovedNote, Note, NoteList, NotesSummary,
    ProjectNotes, StoredLists, StoredNote, StoredProject, StoredState, STORED_VERSION,
};
use super::ports::NotesStorage;
use crate::shared::id::{is_id, new_id};
use crate::shared::sync::lock;

/// The list a book starts with, until `name_first_lists` names it in the UI's language.
const FIRST_LIST_NAME: &str = "General";
/// The id of a book's first list: the same each time a book with nothing written is read, so the
/// list the frontend was given is still there when it writes.
const FIRST_LIST_ID: &str = "0000000000000000";
/// The Inbox's folder: never a project's, whose names end in `-` and 6 hex digits.
const INBOX_FOLDER: &str = "inbox";
const PROJECT_FILE: &str = "project.json";
const LISTS_FILE: &str = "lists.json";
const STATE_FILE: &str = "state.json";
/// A note's file: its text, JSON-escaped (6 bytes for a control character at worst), and a few
/// fields.
const NOTE_FILE_LIMIT: u64 = MAX_NOTE_BYTES as u64 * 6 + 4096;
const OTHER_FILE_LIMIT: u64 = 1024 * 1024;
/// The longest part of a folder's name taken from its project's.
const FOLDER_NAME_LIMIT: usize = 40;

/// Milliseconds since the Unix epoch.
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn note_file(id: &str) -> String {
    format!("{id}.json")
}

/// A folder for a project's notes, named after it to be found by hand: `sidekyk-3f9a2c`.
fn folder_name(project: &str) -> String {
    let name: String = project
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '-',
        })
        .take(FOLDER_NAME_LIMIT)
        .collect();
    let name = name.trim_matches(['-', '.']);
    let suffix = &new_id()[..6];
    if name.is_empty() {
        format!("project-{suffix}")
    } else {
        format!("{name}-{suffix}")
    }
}

/// What only a project's book has: the Inbox has one list, never changed, and no done.
fn project_only(book: &Book, what: &str) -> anyhow::Result<()> {
    anyhow::ensure!(!matches!(book, Book::Inbox), "the Inbox has no {what}");
    Ok(())
}

/// A new id no note of `book` has.
fn new_note_id(book: &NoteBook) -> String {
    let mut id = new_id();
    while book.note(&id).is_some() {
        id = new_id();
    }
    id
}

/// A new id no list of `book` has.
fn new_list_id(book: &NoteBook) -> String {
    let mut id = new_id();
    while book.lists.iter().any(|l| l.id == id) {
        id = new_id();
    }
    id
}

fn parse<T: serde::de::DeserializeOwned>(
    storage: &dyn NotesStorage,
    folder: &str,
    file: &str,
    limit: u64,
) -> Option<T> {
    let bytes = match storage.read(folder, file, limit) {
        Ok(bytes) => bytes?,
        Err(error) => {
            tracing::warn!(folder, file, error = %format!("{error:#}"), "could not read notes");
            return None;
        }
    };
    serde_json::from_slice(&bytes)
        .inspect_err(|error| tracing::warn!(folder, file, %error, "could not read notes"))
        .ok()
}

fn write_json(
    storage: &dyn NotesStorage,
    folder: &str,
    file: &str,
    value: &impl serde::Serialize,
) -> anyhow::Result<()> {
    storage.write(folder, file, &serde_json::to_vec_pretty(value)?)
}

struct KeptBook {
    /// `None` until something of the book is written.
    folder: Option<String>,
    notes: NoteBook,
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
    books: Mutex<HashMap<String, KeptBook>>,
    /// The name of a book's first list, `FIRST_LIST_NAME` until named.
    first_list_name: Mutex<Option<&'static str>>,
}

impl NotesStore {
    /// Names the list a book starts with from now on; lists already there keep theirs.
    pub fn name_first_lists(&self, name: &'static str) {
        *lock(&self.first_list_name) = Some(name);
    }

    /// The folder of a book: the Inbox's always, a project's from its `project.json`.
    fn folder_of(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<Option<String>> {
        let Book::Project { id, .. } = book else {
            return Ok(Some(INBOX_FOLDER.into()));
        };
        let mut folders = lock(&self.folders);
        if folders.is_none() {
            let mut names = storage.folders()?;
            names.sort_unstable();
            let mut found = HashMap::new();
            for folder in names {
                let Some(stored) =
                    parse::<StoredProject>(storage, &folder, PROJECT_FILE, OTHER_FILE_LIMIT)
                else {
                    continue;
                };
                if found.contains_key(&stored.id) {
                    tracing::warn!(folder, "notes of a project already found elsewhere");
                    continue;
                }
                found.insert(stored.id, folder);
            }
            *folders = Some(found);
        }
        Ok(folders.as_ref().and_then(|f| f.get(id).cloned()))
    }

    /// A new folder's name for a project: one no project has, nor any file is in.
    fn free_folder(&self, storage: &dyn NotesStorage, name: &str) -> anyhow::Result<String> {
        loop {
            let folder = folder_name(name);
            let taken = lock(&self.folders)
                .as_ref()
                .is_some_and(|found| found.values().any(|f| *f == folder));
            if !taken && storage.files(&folder)?.is_empty() {
                return Ok(folder);
            }
        }
    }

    fn load(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<KeptBook> {
        let started = Instant::now();
        let folder = self.folder_of(storage, book)?;
        let mut lists = Vec::new();
        let mut notes = Vec::new();
        let mut open_list = None;
        if let Some(folder) = folder.as_deref() {
            for file in storage.files(folder)? {
                if file == LISTS_FILE {
                    if let Some(stored) =
                        parse::<StoredLists>(storage, folder, &file, OTHER_FILE_LIMIT)
                    {
                        lists = stored.lists;
                    }
                } else if file == STATE_FILE {
                    open_list = parse::<StoredState>(storage, folder, &file, OTHER_FILE_LIMIT)
                        .and_then(|s| s.open_list);
                } else if let Some(id) = file.strip_suffix(".json").filter(|id| is_id(id)) {
                    if let Some(stored) =
                        parse::<StoredNote>(storage, folder, &file, NOTE_FILE_LIMIT)
                    {
                        // the file's name is the note's id
                        notes.push(Note {
                            id: id.into(),
                            ..stored.note
                        });
                    }
                }
            }
        }
        let name = lock(&self.first_list_name).unwrap_or(FIRST_LIST_NAME);
        let first_list = || NoteList {
            id: FIRST_LIST_ID.into(),
            name: name.into(),
        };
        let (notes, pending) = NoteBook::mended(lists, notes, open_list, first_list);
        tracing::debug!(
            notes = notes.notes.len(),
            ms = started.elapsed().as_millis() as u64,
            "notes read"
        );
        Ok(KeptBook {
            folder,
            notes,
            pending,
        })
    }

    /// A book's notes in memory, read first when they are not.
    fn kept_book<'a>(
        &self,
        books: &'a mut HashMap<String, KeptBook>,
        storage: &dyn NotesStorage,
        book: &Book,
    ) -> anyhow::Result<&'a mut KeptBook> {
        if !books.contains_key(book.key()) {
            books.insert(book.key().into(), self.load(storage, book)?);
        }
        Ok(books.get_mut(book.key()).expect("just read"))
    }

    /// Looks at a book's notes in memory, read first when they are not.
    fn with_book<T>(
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
    fn change<T>(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        change: impl FnOnce(&mut NoteBook) -> anyhow::Result<(T, Vec<Touched>)>,
    ) -> anyhow::Result<T> {
        let mut books = lock(&self.books);
        let kept = self.kept_book(&mut books, storage, book)?;
        let (value, touched) = change(&mut kept.notes)?;
        if let Err(error) = self.write(storage, book, kept, touched) {
            books.remove(book.key());
            return Err(error);
        }
        Ok(value)
    }

    /// Runs a change that moves notes from `giver` to `taker`, two books, and writes `taker`'s
    /// files first: a failure between leaves notes in both, never in neither. A failure drops
    /// both books from memory.
    fn exchange<T>(
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
        touched.append(&mut kept.pending);
        let folder = match (&kept.folder, book) {
            (Some(folder), _) => folder.clone(),
            (None, Book::Inbox) => unreachable!("the Inbox's folder is known"),
            (None, Book::Project { id, name }) => {
                let folder = self.free_folder(storage, name)?;
                write_json(
                    storage,
                    &folder,
                    PROJECT_FILE,
                    &StoredProject {
                        version: STORED_VERSION,
                        id: id.clone(),
                    },
                )?;
                lock(&self.folders)
                    .get_or_insert_with(HashMap::new)
                    .insert(id.clone(), folder.clone());
                kept.folder = Some(folder.clone());
                // the first list was made in memory
                touched.push(Touched::Lists);
                folder
            }
        };
        let mut seen = HashSet::new();
        touched.retain(|t| seen.insert(t.clone()));
        let notes = &kept.notes;
        for touched in touched {
            match touched {
                Touched::Note(id) => match notes.note(&id) {
                    Some(note) => write_json(
                        storage,
                        &folder,
                        &note_file(&id),
                        &StoredNote {
                            version: STORED_VERSION,
                            note: note.clone(),
                        },
                    )?,
                    None => storage.remove(&folder, &note_file(&id))?,
                },
                Touched::Lists => write_json(
                    storage,
                    &folder,
                    LISTS_FILE,
                    &StoredLists {
                        version: STORED_VERSION,
                        lists: notes.lists.clone(),
                    },
                )?,
                Touched::State => write_json(
                    storage,
                    &folder,
                    STATE_FILE,
                    &StoredState {
                        version: STORED_VERSION,
                        open_list: Some(notes.open_list.clone()),
                    },
                )?,
            }
        }
        Ok(())
    }

    /// A book's notes; none written yet is a first, empty list.
    pub fn notes(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<ProjectNotes> {
        self.with_book(storage, book, NoteBook::snapshot)
    }

    /// What a book tells of its notes: a project's card at all projects.
    pub fn summary(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<NotesSummary> {
        self.with_book(storage, book, NoteBook::summary)
    }

    /// How many notes a book has, open and done.
    pub fn count(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<usize> {
        self.with_book(storage, book, |notes| notes.notes.len())
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

    /// Moves a list with its notes to another project: into its list of the same name, else
    /// added last. What comes back undoes it.
    pub fn move_list(
        &self,
        storage: &dyn NotesStorage,
        from: &Book,
        list: &str,
        to: &Book,
    ) -> anyhow::Result<MovedList> {
        project_only(from, "lists")?;
        project_only(to, "lists")?;
        self.exchange(storage, from, to, |giving, taking| {
            let (left, gave) = giving.delete_list(list)?;
            let (into, joined, took) =
                taking.absorb(&left.list, left.notes.clone(), new_list_id(taking))?;
            let moved = MovedList {
                from: from.key().into(),
                to: to.key().into(),
                left,
                into,
                joined,
            };
            Ok((moved, gave, took))
        })
    }

    /// Brings a moved list back where it was with its notes, and takes them out of the project
    /// they went to, with the list made for them (undo). `from` and `to` are `moved`'s books.
    pub fn unmove_list(
        &self,
        storage: &dyn NotesStorage,
        from: &Book,
        to: &Book,
        moved: MovedList,
    ) -> anyhow::Result<()> {
        project_only(from, "lists")?;
        project_only(to, "lists")?;
        let MovedList {
            left, into, joined, ..
        } = moved;
        let ids: Vec<String> = left.notes.iter().map(|n| n.id.clone()).collect();
        self.exchange(storage, to, from, |giving, taking| {
            let (_, took) = taking.restore_list(left)?;
            Ok(((), giving.unabsorb(&into, joined, &ids), took))
        })
    }

    pub fn add_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        name: &str,
    ) -> anyhow::Result<NoteList> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| {
            notes.add_list(new_list_id(notes), name)
        })
    }

    pub fn rename_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
        name: &str,
    ) -> anyhow::Result<NoteList> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| notes.rename_list(id, name))
    }

    pub fn delete_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
    ) -> anyhow::Result<DeletedList> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| notes.delete_list(id))
    }

    pub fn restore_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        deleted: DeletedList,
    ) -> anyhow::Result<ProjectNotes> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| notes.restore_list(deleted))
    }

    pub fn open_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
    ) -> anyhow::Result<()> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| Ok(((), notes.open(id)?)))
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::modules::notes::INBOX_BOOK;
    use crate::shared::error::{user_facing_code, UserFacingErrorCode};
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
    }

    impl MemoryStorage {
        fn names(&self) -> Vec<(String, String)> {
            lock(&self.files).keys().cloned().collect()
        }

        /// What was read since the last call.
        fn reads(&self) -> usize {
            self.reads.swap(0, Ordering::Relaxed)
        }
    }

    const SHOP: &str = "/dev/shop";

    fn project(id: &str, name: &str) -> Book {
        Book::Project {
            id: id.into(),
            name: name.into(),
        }
    }

    fn shop() -> Book {
        project(SHOP, "shop")
    }

    fn docs() -> Book {
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
        let project: StoredProject = parse(&storage, folder, PROJECT_FILE, 1024).unwrap();
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

    #[test]
    fn a_broken_note_is_skipped() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        store
            .add_note(&storage, &shop(), &list, "a".into())
            .unwrap();
        let folder = storage.folders().unwrap().remove(0);
        storage
            .write(&folder, "0123456789abcdef.json", b"{ not json")
            .unwrap();

        let notes = NotesStore::default().notes(&storage, &shop()).unwrap();
        assert_eq!(notes.notes.len(), 1);
    }

    /// Two books with a note each, written by another store: on disk, none in memory.
    fn two_books_on_disk() -> MemoryStorage {
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
        // the cards read every book
        for book in [shop(), docs()] {
            assert_eq!(store.summary(&storage, &book).unwrap().open, 1);
        }
        assert!(storage.reads() > 0);
        // a project switch, its card, an export, the palette: no file read again
        store.notes(&storage, &shop()).unwrap();
        store.notes(&storage, &docs()).unwrap();
        store.summary(&storage, &shop()).unwrap();
        store.with_notes(&storage, &shop(), |_, _| ()).unwrap();
        assert_eq!(store.count(&storage, &docs()).unwrap(), 1);
        assert_eq!(storage.reads(), 0);
    }

    #[test]
    fn a_summary_comes_from_the_notes_changed() {
        let storage = two_books_on_disk();
        let store = NotesStore::default();
        let list = store.notes(&storage, &shop()).unwrap().open_list;
        store
            .add_note(&storage, &shop(), &list, "b".into())
            .unwrap();
        store.notes(&storage, &docs()).unwrap();
        assert_eq!(store.summary(&storage, &shop()).unwrap().open, 2);
        assert_eq!(store.count(&storage, &shop()).unwrap(), 2);
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
        assert_eq!(store.count(&storage, &shop()).unwrap(), 2);
        assert_eq!(
            store
                .count(&storage, &project("/dev/other", "other"))
                .unwrap(),
            0
        );

        store.delete_book(&storage, &shop()).unwrap();
        assert!(storage.names().is_empty());
        // gone from memory too
        assert_eq!(store.count(&storage, &shop()).unwrap(), 0);
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

    #[test]
    fn folders_are_named_after_their_project() {
        assert!(folder_name("side kyk").starts_with("side-kyk-"));
        assert!(folder_name("Città/casa").starts_with("Citt--casa-"));
        assert!(folder_name("...").starts_with("project-"));
        assert_eq!(folder_name(&"a".repeat(100)).len(), FOLDER_NAME_LIMIT + 7);
    }

    /// The texts of a book's open notes in a list, from the top.
    fn texts(store: &NotesStore, storage: &MemoryStorage, book: &Book, list: &str) -> Vec<String> {
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

    fn list_named(store: &NotesStore, storage: &MemoryStorage, book: &Book, name: &str) -> String {
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

    #[test]
    fn a_list_moves_to_another_project_and_back() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let release = store.add_list(&storage, &shop(), "Release").unwrap();
        let done = store
            .add_note(&storage, &shop(), &release.id, "done".into())
            .unwrap();
        store
            .set_note_done(&storage, &shop(), &done.id, true)
            .unwrap();
        store
            .add_note(&storage, &shop(), &release.id, "open".into())
            .unwrap();
        let before = store.notes(&storage, &shop()).unwrap();

        let moved = store
            .move_list(&storage, &shop(), &release.id, &docs())
            .unwrap();
        assert!(!moved.joined);
        assert_eq!((moved.left.index, moved.left.notes.len()), (1, 2));
        let notes = store.notes(&storage, &docs()).unwrap();
        assert_eq!(notes.lists[1].id, moved.into);
        assert_eq!(notes.lists[1].name, "Release");
        assert_eq!(notes.notes.len(), 2);
        assert_eq!(store.notes(&storage, &shop()).unwrap().lists.len(), 1);

        store
            .unmove_list(&storage, &shop(), &docs(), moved)
            .unwrap();
        let mut after = store.notes(&storage, &shop()).unwrap();
        let mut before = before;
        after.notes.sort_by(|a, b| a.id.cmp(&b.id));
        before.notes.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(after, before);
        let docs_notes = store.notes(&storage, &docs()).unwrap();
        assert_eq!((docs_notes.lists.len(), docs_notes.notes.len()), (1, 0));
    }

    #[test]
    fn a_list_moved_where_one_has_its_name_joins_it_until_undone() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let release = store.add_list(&storage, &shop(), "Release").unwrap();
        store
            .add_note(&storage, &shop(), &release.id, "moved".into())
            .unwrap();
        let theirs = store.add_list(&storage, &docs(), "release").unwrap();
        store
            .add_note(&storage, &docs(), &theirs.id, "theirs".into())
            .unwrap();

        let moved = store
            .move_list(&storage, &shop(), &release.id, &docs())
            .unwrap();
        assert!(moved.joined);
        assert_eq!(moved.into, theirs.id);
        assert_eq!(
            texts(&store, &storage, &docs(), &theirs.id),
            ["theirs", "moved"]
        );

        store
            .unmove_list(&storage, &shop(), &docs(), moved)
            .unwrap();
        assert_eq!(texts(&store, &storage, &docs(), &theirs.id), ["theirs"]);
        assert_eq!(texts(&store, &storage, &shop(), &release.id), ["moved"]);
    }

    #[test]
    fn the_last_list_of_a_project_does_not_move() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        assert!(store
            .move_list(&storage, &shop(), &general, &docs())
            .is_err());
    }
}
