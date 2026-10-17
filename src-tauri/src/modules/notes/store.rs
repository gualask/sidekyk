//! A project's notes on disk: one folder per project, one file per note, so a change writes one
//! small file and two machines syncing them clash only on the same note.
//!
//! ```text
//! <folder>/project.json   { version, root }
//! <folder>/lists.json     { version, lists: [{ id, name }] }   the user's order
//! <folder>/state.json     { version, openList }                this machine only
//! <folder>/<id>.json      { version, id, list, position, text, created, edited, done }
//! ```
//!
//! The project read last stays in memory: every change goes to it, then to its files.

use std::collections::hash_map::RandomState;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::book::{is_id, Book, Touched, MAX_NOTE_BYTES};
use super::contracts::{
    DeletedList, Note, NoteList, NotesSummary, ProjectNotes, StoredLists, StoredNote,
    StoredProject, StoredState, STORED_VERSION,
};
use super::ports::NotesStorage;
use crate::shared::sync::lock;

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

/// A new id: 16 hex digits of a hash keyed by the system's randomness, the time and a counter.
fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    format!("{:016x}", hasher.finish())
}

fn note_file(id: &str) -> String {
    format!("{id}.json")
}

/// A folder for a project's notes, named after it to be found by hand: `sidekyk-3f9a2c`.
fn folder_name(root: &str) -> String {
    let name: String = root
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
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

struct OpenBook {
    root: String,
    /// `None` until something of the project is written.
    folder: Option<String>,
    book: Book,
    /// Mended on reading, written with the next change.
    pending: Vec<Touched>,
}

/// Every project's notes, through the storage given to each call.
#[derive(Default)]
pub(crate) struct NotesStore {
    /// Which folder holds each project's notes, by root: read once.
    folders: Mutex<Option<HashMap<String, String>>>,
    open: Mutex<Option<OpenBook>>,
    /// What the projects' cards tell, by root, once read: notes change only through here.
    summaries: Mutex<HashMap<String, NotesSummary>>,
}

impl NotesStore {
    /// The folder of each project, from their `project.json`.
    fn folder_of(&self, storage: &dyn NotesStorage, root: &str) -> anyhow::Result<Option<String>> {
        let mut folders = lock(&self.folders);
        if folders.is_none() {
            let mut names = storage.folders()?;
            names.sort_unstable();
            let mut found = HashMap::new();
            for folder in names {
                let Some(project) =
                    parse::<StoredProject>(storage, &folder, PROJECT_FILE, OTHER_FILE_LIMIT)
                else {
                    continue;
                };
                if found.contains_key(&project.root) {
                    tracing::warn!(folder, "notes of a project already found elsewhere");
                    continue;
                }
                found.insert(project.root, folder);
            }
            *folders = Some(found);
        }
        Ok(folders.as_ref().and_then(|f| f.get(root).cloned()))
    }

    /// A new folder's name for a project: one no project has, nor any file is in.
    fn free_folder(&self, storage: &dyn NotesStorage, root: &str) -> anyhow::Result<String> {
        loop {
            let folder = folder_name(root);
            let taken = lock(&self.folders)
                .as_ref()
                .is_some_and(|found| found.values().any(|f| *f == folder));
            if !taken && storage.files(&folder)?.is_empty() {
                return Ok(folder);
            }
        }
    }

    fn load(&self, storage: &dyn NotesStorage, root: &str) -> anyhow::Result<OpenBook> {
        let started = Instant::now();
        let folder = self.folder_of(storage, root)?;
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
        let (book, pending) = Book::mended(lists, notes, open_list, new_id);
        tracing::debug!(
            notes = book.notes.len(),
            ms = started.elapsed().as_millis() as u64,
            "notes read"
        );
        Ok(OpenBook {
            root: root.into(),
            folder,
            book,
            pending,
        })
    }

    /// Runs a change on a project's notes, read first unless they are the last read, then writes
    /// what it touched. A failed write drops what is in memory: the next call reads the files.
    fn change<T>(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        change: impl FnOnce(&mut Book) -> anyhow::Result<(T, Vec<Touched>)>,
    ) -> anyhow::Result<T> {
        let mut open = lock(&self.open);
        if open.as_ref().is_none_or(|o| o.root != root) {
            *open = Some(self.load(storage, root)?);
        }
        let Some(current) = open.as_mut() else {
            unreachable!("just read")
        };
        let (value, touched) = change(&mut current.book)?;
        if touched.is_empty() {
            return Ok(value);
        }
        let mut touched = touched;
        touched.append(&mut current.pending);
        lock(&self.summaries).remove(root);
        if let Err(error) = self.write(storage, current, touched) {
            *open = None;
            return Err(error);
        }
        Ok(value)
    }

    fn write(
        &self,
        storage: &dyn NotesStorage,
        open: &mut OpenBook,
        mut touched: Vec<Touched>,
    ) -> anyhow::Result<()> {
        let folder = match &open.folder {
            Some(folder) => folder.clone(),
            None => {
                let folder = self.free_folder(storage, &open.root)?;
                write_json(
                    storage,
                    &folder,
                    PROJECT_FILE,
                    &StoredProject {
                        version: STORED_VERSION,
                        root: open.root.clone(),
                    },
                )?;
                lock(&self.folders)
                    .get_or_insert_with(HashMap::new)
                    .insert(open.root.clone(), folder.clone());
                open.folder = Some(folder.clone());
                // the first list was made in memory
                touched.push(Touched::Lists);
                folder
            }
        };
        let mut seen = HashSet::new();
        touched.retain(|t| seen.insert(t.clone()));
        let book = &open.book;
        for touched in touched {
            match touched {
                Touched::Note(id) => match book.note(&id) {
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
                        lists: book.lists.clone(),
                    },
                )?,
                Touched::State => write_json(
                    storage,
                    &folder,
                    STATE_FILE,
                    &StoredState {
                        version: STORED_VERSION,
                        open_list: Some(book.open_list.clone()),
                    },
                )?,
            }
        }
        Ok(())
    }

    /// A project's notes; none written yet is a first, empty list.
    pub(crate) fn notes(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
    ) -> anyhow::Result<ProjectNotes> {
        self.change(storage, root, |book| Ok((book.snapshot(), Vec::new())))
    }

    /// What a project's card tells of its notes: from those in memory, else read once (without
    /// replacing those in memory) and kept until they change.
    pub(crate) fn summary(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
    ) -> anyhow::Result<NotesSummary> {
        // held throughout, as a change holds it: a summary read meanwhile could keep notes older
        // than the change that cleared it
        let open = lock(&self.open);
        if let Some(open) = open.as_ref().filter(|o| o.root == root) {
            return Ok(open.book.summary());
        }
        if let Some(summary) = lock(&self.summaries).get(root) {
            return Ok(summary.clone());
        }
        let summary = self.load(storage, root)?.book.summary();
        lock(&self.summaries).insert(root.into(), summary.clone());
        Ok(summary)
    }

    /// How many notes a project has, open and done, counted from its files without reading them.
    pub(crate) fn count(&self, storage: &dyn NotesStorage, root: &str) -> anyhow::Result<usize> {
        let Some(folder) = self.folder_of(storage, root)? else {
            return Ok(0);
        };
        Ok(storage
            .files(&folder)?
            .iter()
            .filter(|file| file.strip_suffix(".json").is_some_and(is_id))
            .count())
    }

    /// Deletes a project's notes, its folder with them: the project goes.
    pub(crate) fn delete_project(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
    ) -> anyhow::Result<()> {
        let mut open = lock(&self.open);
        if let Some(folder) = self.folder_of(storage, root)? {
            storage.remove_folder(&folder)?;
        }
        if let Some(found) = lock(&self.folders).as_mut() {
            found.remove(root);
        }
        lock(&self.summaries).remove(root);
        if open.as_ref().is_some_and(|o| o.root == root) {
            *open = None;
        }
        Ok(())
    }

    /// A project found again at `to` (its repository moved): its notes go with it. When `to` has
    /// notes already (it is a project too), they take these in and this project's folder goes.
    pub(crate) fn relink(
        &self,
        storage: &dyn NotesStorage,
        from: &str,
        to: &str,
    ) -> anyhow::Result<()> {
        if from == to {
            return Ok(());
        }
        let mut open = lock(&self.open);
        let Some(from_folder) = self.folder_of(storage, from)? else {
            return Ok(());
        };
        // whatever was read is read again
        *open = None;
        if self.folder_of(storage, to)?.is_none() {
            write_json(
                storage,
                &from_folder,
                PROJECT_FILE,
                &StoredProject {
                    version: STORED_VERSION,
                    root: to.into(),
                },
            )?;
        } else {
            let source = self.load(storage, from)?;
            let mut target = self.load(storage, to)?;
            let mut touched = target.book.absorb(source.book);
            touched.append(&mut target.pending);
            self.write(storage, &mut target, touched)?;
            // a failure here leaves the notes in both folders: harmless, as a note is its id, and
            // the next relink or removal of the old root clears it
            storage.remove_folder(&from_folder)?;
        }
        if let Some(found) = lock(&self.folders).as_mut() {
            found.remove(from);
            found.entry(to.into()).or_insert(from_folder);
        }
        let mut summaries = lock(&self.summaries);
        summaries.remove(from);
        summaries.remove(to);
        Ok(())
    }

    /// Looks at a project's lists and notes without making them the ones kept in memory: those of
    /// the project on screen stay (an export from all projects).
    pub(crate) fn read_notes<T>(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        look: impl FnOnce(&[NoteList], &[Note]) -> T,
    ) -> anyhow::Result<T> {
        let open = lock(&self.open);
        if let Some(open) = open.as_ref().filter(|o| o.root == root) {
            return Ok(look(&open.book.lists, &open.book.notes));
        }
        let other = self.load(storage, root)?;
        Ok(look(&other.book.lists, &other.book.notes))
    }

    /// Looks at a project's lists and notes where they are kept, without a copy: the palette
    /// searches them at every key.
    pub(crate) fn with_notes<T>(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        look: impl FnOnce(&[NoteList], &[Note]) -> T,
    ) -> anyhow::Result<T> {
        self.change(storage, root, |book| {
            Ok((look(&book.lists, &book.notes), Vec::new()))
        })
    }

    pub(crate) fn add_note(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        list: &str,
        text: String,
    ) -> anyhow::Result<Note> {
        self.change(storage, root, |book| {
            let mut id = new_id();
            while book.note(&id).is_some() {
                id = new_id();
            }
            book.add(id, list, text, now())
        })
    }

    pub(crate) fn set_note_text(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        id: &str,
        text: String,
    ) -> anyhow::Result<Note> {
        self.change(storage, root, |book| book.set_text(id, text, now()))
    }

    pub(crate) fn set_note_done(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        id: &str,
        done: bool,
    ) -> anyhow::Result<Note> {
        self.change(storage, root, |book| book.set_done(id, done, now()))
    }

    /// Moves a note to `index` among the open notes of `list`; the notes whose place changed come
    /// back.
    pub(crate) fn place_note(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        id: &str,
        list: &str,
        index: usize,
    ) -> anyhow::Result<Vec<Note>> {
        self.change(storage, root, |book| book.place(id, list, index))
    }

    pub(crate) fn restore_note(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        note: Note,
    ) -> anyhow::Result<Note> {
        self.change(storage, root, |book| book.restore(note))
    }

    pub(crate) fn delete_note(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        id: &str,
    ) -> anyhow::Result<()> {
        self.change(storage, root, |book| Ok(((), book.delete(id)?)))
    }

    pub(crate) fn add_list(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        name: &str,
    ) -> anyhow::Result<NoteList> {
        self.change(storage, root, |book| {
            let mut id = new_id();
            while book.lists.iter().any(|l| l.id == id) {
                id = new_id();
            }
            book.add_list(id, name)
        })
    }

    pub(crate) fn rename_list(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        id: &str,
        name: &str,
    ) -> anyhow::Result<NoteList> {
        self.change(storage, root, |book| book.rename_list(id, name))
    }

    pub(crate) fn delete_list(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        id: &str,
    ) -> anyhow::Result<DeletedList> {
        self.change(storage, root, |book| book.delete_list(id))
    }

    pub(crate) fn restore_list(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        deleted: DeletedList,
    ) -> anyhow::Result<ProjectNotes> {
        self.change(storage, root, |book| book.restore_list(deleted))
    }

    pub(crate) fn open_list(
        &self,
        storage: &dyn NotesStorage,
        root: &str,
        id: &str,
    ) -> anyhow::Result<()> {
        self.change(storage, root, |book| Ok(((), book.open(id)?)))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::BTreeMap;

    /// Folders of files in memory; `fail_writes` makes every write fail.
    #[derive(Default)]
    pub(crate) struct MemoryStorage {
        pub(crate) files: Mutex<BTreeMap<(String, String), Vec<u8>>>,
        pub(crate) fail_writes: std::sync::atomic::AtomicBool,
    }

    impl NotesStorage for MemoryStorage {
        fn folders(&self) -> anyhow::Result<Vec<String>> {
            let mut folders: Vec<String> =
                lock(&self.files).keys().map(|(f, _)| f.clone()).collect();
            folders.dedup();
            Ok(folders)
        }

        fn files(&self, folder: &str) -> anyhow::Result<Vec<String>> {
            Ok(lock(&self.files)
                .keys()
                .filter(|(f, _)| f == folder)
                .map(|(_, name)| name.clone())
                .collect())
        }

        fn read(&self, folder: &str, file: &str, limit: u64) -> anyhow::Result<Option<Vec<u8>>> {
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
    }

    const ROOT: &str = "/dev/shop";

    #[test]
    fn reading_a_project_without_notes_writes_nothing() {
        let storage = MemoryStorage::default();
        let notes = NotesStore::default().notes(&storage, ROOT).unwrap();
        assert_eq!(notes.lists.len(), 1);
        assert_eq!(notes.lists[0].name, "General");
        assert!(notes.notes.is_empty());
        assert!(storage.names().is_empty());
    }

    #[test]
    fn the_first_note_writes_the_project_its_lists_and_itself() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, ROOT).unwrap().open_list;
        let note = store
            .add_note(&storage, ROOT, &general, "Try the rail".into())
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
        assert_eq!(project.root, ROOT);
    }

    #[test]
    fn notes_come_back_from_their_files() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, ROOT).unwrap().open_list;
        let first = store
            .add_note(&storage, ROOT, &general, "a".into())
            .unwrap();
        store
            .set_note_done(&storage, ROOT, &first.id, true)
            .unwrap();
        let release = store.add_list(&storage, ROOT, "Release").unwrap();
        store
            .add_note(&storage, ROOT, &release.id, "b".into())
            .unwrap();

        let written = store.notes(&storage, ROOT).unwrap();
        let mut read = NotesStore::default().notes(&storage, ROOT).unwrap();
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
        for root in [ROOT, "/dev/docs"] {
            let list = store.notes(&storage, root).unwrap().open_list;
            store.add_note(&storage, root, &list, root.into()).unwrap();
        }
        assert_eq!(storage.folders().unwrap().len(), 2);
        let fresh = NotesStore::default();
        assert_eq!(fresh.notes(&storage, ROOT).unwrap().notes[0].text, ROOT);
        assert_eq!(
            fresh.notes(&storage, "/dev/docs").unwrap().notes[0].text,
            "/dev/docs"
        );
    }

    #[test]
    fn a_deleted_note_leaves_no_file() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        let note = store.add_note(&storage, ROOT, &list, "a".into()).unwrap();
        store.delete_note(&storage, ROOT, &note.id).unwrap();
        assert!(!storage
            .names()
            .iter()
            .any(|(_, file)| *file == note_file(&note.id)));
    }

    #[test]
    fn a_failed_write_reads_the_files_again() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        let note = store.add_note(&storage, ROOT, &list, "a".into()).unwrap();
        storage.fail_writes.store(true, Ordering::Relaxed);
        assert!(store
            .set_note_text(&storage, ROOT, &note.id, "b".into())
            .is_err());
        storage.fail_writes.store(false, Ordering::Relaxed);
        assert_eq!(store.notes(&storage, ROOT).unwrap().notes[0].text, "a");
    }

    #[test]
    fn a_broken_note_is_skipped() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        store.add_note(&storage, ROOT, &list, "a".into()).unwrap();
        let folder = storage.folders().unwrap().remove(0);
        storage
            .write(&folder, "0123456789abcdef.json", b"{ not json")
            .unwrap();

        let notes = NotesStore::default().notes(&storage, ROOT).unwrap();
        assert_eq!(notes.notes.len(), 1);
    }

    #[test]
    fn a_summary_is_kept_until_the_notes_change() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        for root in [ROOT, "/dev/docs"] {
            let list = store.notes(&storage, root).unwrap().open_list;
            store.add_note(&storage, root, &list, "a".into()).unwrap();
        }
        // ROOT is not the one in memory: read once, kept
        assert_eq!(store.summary(&storage, ROOT).unwrap().open, 1);
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        store.add_note(&storage, ROOT, &list, "b".into()).unwrap();
        store.notes(&storage, "/dev/docs").unwrap();
        assert_eq!(
            store.summary(&storage, ROOT).unwrap(),
            NotesSummary {
                open: 2,
                newest: Some("b".into()),
            }
        );
    }

    #[test]
    fn a_project_deleted_leaves_nothing_and_counts_none() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        store.add_note(&storage, ROOT, &list, "a".into()).unwrap();
        store.add_note(&storage, ROOT, &list, "b".into()).unwrap();
        assert_eq!(store.count(&storage, ROOT).unwrap(), 2);
        assert_eq!(store.count(&storage, "/dev/other").unwrap(), 0);

        store.delete_project(&storage, ROOT).unwrap();
        assert!(storage.names().is_empty());
        assert_eq!(store.count(&storage, ROOT).unwrap(), 0);
        // added again, it starts with none
        assert!(store.notes(&storage, ROOT).unwrap().notes.is_empty());
    }

    #[test]
    fn notes_follow_their_project_found_elsewhere() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        store.add_note(&storage, ROOT, &list, "a".into()).unwrap();
        store.relink(&storage, ROOT, "/moved/shop").unwrap();

        let fresh = NotesStore::default();
        assert!(fresh.notes(&storage, ROOT).unwrap().notes.is_empty());
        assert_eq!(
            fresh.notes(&storage, "/moved/shop").unwrap().notes[0].text,
            "a"
        );
        assert_eq!(storage.folders().unwrap().len(), 1);
    }

    #[test]
    fn notes_found_where_they_were_stay() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        store.add_note(&storage, ROOT, &list, "a".into()).unwrap();
        store.relink(&storage, ROOT, ROOT).unwrap();
        assert_eq!(
            NotesStore::default()
                .notes(&storage, ROOT)
                .unwrap()
                .notes
                .len(),
            1
        );
    }

    #[test]
    fn notes_found_at_another_project_join_its_own() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        for (root, text) in [(ROOT, "old"), ("/moved/shop", "new")] {
            let list = store.notes(&storage, root).unwrap().open_list;
            store.add_note(&storage, root, &list, text.into()).unwrap();
        }
        store.relink(&storage, ROOT, "/moved/shop").unwrap();

        let notes = NotesStore::default()
            .notes(&storage, "/moved/shop")
            .unwrap();
        let mut texts: Vec<&str> = notes.notes.iter().map(|n| n.text.as_str()).collect();
        texts.sort_unstable();
        assert_eq!(texts, ["new", "old"]);
        // one General list, the old one's notes in it
        assert_eq!(notes.lists.len(), 1);
        assert_eq!(storage.folders().unwrap().len(), 1);
    }

    #[test]
    fn a_new_folder_never_takes_one_in_use() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        // two projects of the same name
        for root in ["/a/shop", "/b/shop"] {
            let list = store.notes(&storage, root).unwrap().open_list;
            store.add_note(&storage, root, &list, root.into()).unwrap();
        }
        assert_eq!(storage.folders().unwrap().len(), 2);
    }

    #[test]
    fn a_note_file_names_its_note() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let list = store.notes(&storage, ROOT).unwrap().open_list;
        let note = store.add_note(&storage, ROOT, &list, "a".into()).unwrap();
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
            .notes(&storage, ROOT)
            .unwrap()
            .notes
            .into_iter()
            .map(|n| n.id)
            .collect();
        assert_eq!(ids, HashSet::from([note.id, "00000000000000ff".into()]));
    }

    #[test]
    fn folders_are_named_after_their_project() {
        assert!(folder_name("/Users/me/Dev/side kyk/").starts_with("side-kyk-"));
        assert!(folder_name(r"C:\Dev\shop").starts_with("shop-"));
        assert!(folder_name("/").starts_with("project-"));
        let long = format!("/{}", "a".repeat(100));
        assert_eq!(folder_name(&long).len(), FOLDER_NAME_LIMIT + 7);
    }

    #[test]
    fn ids_are_new_each_time() {
        let ids: HashSet<String> = (0..1000).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 1000);
        assert!(ids.iter().all(|id| is_id(id)));
    }
}
