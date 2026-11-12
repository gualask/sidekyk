//! A book's files: one folder per book, one file per note.
//!
//! ```text
//! <folder>/project.json   { version, id }      the project's id (`root` before ids)
//! <folder>/lists.json     { version, lists: [{ id, name }] }   the user's order
//! <folder>/state.json     { version, openList }                this machine only
//! <folder>/<id>.json      { version, id, list, position, text, created, edited, done, images }
//! <folder>/<image>.<ext>   an image of a note, as given (png, jpg, gif, webp)
//! <folder>/<image>.thumb.png   its thumbnail
//! ```
//!
//! A marked image is a PNG of its own, its JSON naming the image under its marks, whose files
//! stay with it.
//!
//! A project's folder is named after it; the Inbox's is `inbox`, without `project.json`.

mod writes;

use std::collections::{HashMap, HashSet};

use anyhow::Context;

use super::book::MAX_NOTE_BYTES;
use super::contracts::{
    Note, NoteImage, NoteList, StoredLists, StoredNote, StoredProject, StoredState, STORED_VERSION,
};
use super::images::image_of_file;
use super::ports::NotesStorage;
use crate::shared::error::{UserFacingError, UserFacingErrorCode};
use crate::shared::id::{is_id, new_id};

pub(super) use writes::{write_json, write_touched};

pub(super) const PROJECT_FILE: &str = "project.json";
pub(super) const LISTS_FILE: &str = "lists.json";
pub(super) const STATE_FILE: &str = "state.json";
/// A note's file: its text, JSON-escaped (6 bytes for a control character at worst), and a few
/// fields.
pub(super) const NOTE_FILE_LIMIT: u64 = MAX_NOTE_BYTES as u64 * 6 + 4096;
pub(super) const OTHER_FILE_LIMIT: u64 = 1024 * 1024;
/// The longest part of a folder's name taken from its project's.
pub(super) const FOLDER_NAME_LIMIT: usize = 40;

pub(super) fn note_file(id: &str) -> String {
    format!("{id}.json")
}

/// A folder for a project's notes, named after it to be found by hand: `sidekyk-3f9a2c`.
pub(super) fn folder_name(project: &str) -> String {
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

/// Removes the files of images no note of a folder has: left by a note deleted, an image taken
/// out or a note moved, in the session before.
pub(super) fn sweep(storage: &dyn NotesStorage, folder: &str, notes: &[Note], files: &[String]) {
    let kept: HashSet<&str> = notes
        .iter()
        .flat_map(|n| n.images.iter().flat_map(NoteImage::ids))
        .collect();
    let unused = files
        .iter()
        .filter(|file| image_of_file(file).is_some_and(|id| !kept.contains(id)));
    for file in unused {
        match storage.remove(folder, file) {
            Ok(()) => tracing::debug!(folder, file, "image of no note removed"),
            Err(error) => {
                tracing::warn!(folder, file, error = %format!("{error:#}"), "image of no note stays");
            }
        }
    }
}

/// A stored file's form, which says the version it is in.
trait Stored: serde::de::DeserializeOwned {
    fn version(&self) -> u8;
}

impl Stored for StoredNote {
    fn version(&self) -> u8 {
        self.version
    }
}

impl Stored for StoredLists {
    fn version(&self) -> u8 {
        self.version
    }
}

impl Stored for StoredState {
    fn version(&self) -> u8 {
        self.version
    }
}

/// The project a folder's notes belong to, from its `project.json`, written once with the folder.
/// One that does not read leaves the folder to no project, untouched: its notes are not shown,
/// and the project's next note goes to a new folder.
pub(super) fn project_of(storage: &dyn NotesStorage, folder: &str) -> Option<StoredProject> {
    let read = || -> anyhow::Result<Option<StoredProject>> {
        let Some(bytes) = storage.read(folder, PROJECT_FILE, OTHER_FILE_LIMIT)? else {
            return Ok(None);
        };
        Ok(Some(serde_json::from_slice(&bytes)?))
    };
    read().unwrap_or_else(|error| {
        tracing::error!(folder, error = %format!("{error:#}"), "notes of no project: its file does not read");
        None
    })
}

/// Which folder holds each project's notes, by project id: the first by name of the folders that
/// name a project.
pub(super) fn project_folders(
    storage: &dyn NotesStorage,
) -> anyhow::Result<HashMap<String, String>> {
    let mut names = storage.folders()?;
    names.sort_unstable();
    let mut found = HashMap::new();
    for folder in names {
        let Some(stored) = project_of(storage, &folder) else {
            continue;
        };
        if found.contains_key(&stored.id) {
            tracing::warn!(folder, "notes of a project already found elsewhere");
            continue;
        }
        found.insert(stored.id, folder);
    }
    Ok(found)
}

/// Why a book is refused, as the user is told: `NotesUnreadable`.
pub(super) fn refusal(cause: anyhow::Error) -> anyhow::Error {
    cause.context(UserFacingError::new(UserFacingErrorCode::NotesUnreadable))
}

/// A file of a book; none when it is not there. One whose text does not read, or that a newer
/// version wrote (a form this one may not keep whole), refuses the book: `NotesUnreadable`.
fn read_stored<T: Stored>(
    storage: &dyn NotesStorage,
    folder: &str,
    file: &str,
    limit: u64,
) -> anyhow::Result<Option<T>> {
    let Some(bytes) = storage.read(folder, file, limit)? else {
        return Ok(None);
    };
    let stored: T = serde_json::from_slice(&bytes)
        .with_context(|| format!("reading {folder}/{file}"))
        .map_err(refusal)?;
    if stored.version() > STORED_VERSION {
        return Err(refusal(anyhow::anyhow!(
            "{folder}/{file} is of version {}, this one reads up to {STORED_VERSION}",
            stored.version()
        )));
    }
    Ok(Some(stored))
}

/// The lists of `lists.json`: each with an id, none twice, else the book is refused.
fn checked_lists(folder: &str, lists: Vec<NoteList>) -> anyhow::Result<Vec<NoteList>> {
    let mut seen = HashSet::new();
    if let Some(list) = lists
        .iter()
        .find(|l| !is_id(&l.id) || !seen.insert(l.id.as_str()))
    {
        return Err(refusal(anyhow::anyhow!(
            "{folder}/{LISTS_FILE}: the list {:?} again or with no id",
            list.id
        )));
    }
    Ok(lists)
}

/// What a book's folder holds, as read: its lists, its notes, the list open on this machine and
/// the files of its images.
#[derive(Default)]
pub(super) struct FolderFiles {
    pub(super) lists: Vec<NoteList>,
    pub(super) notes: Vec<Note>,
    pub(super) open_list: Option<String>,
    pub(super) images: Vec<String>,
}

/// The files of a book's folder. One that does not read refuses the book (`read_stored`), but the
/// list open: this machine's alone, written again as another list opens, one that does not read
/// opens the first list.
pub(super) fn read_folder(storage: &dyn NotesStorage, folder: &str) -> anyhow::Result<FolderFiles> {
    let mut read = FolderFiles::default();
    for file in storage.files(folder)? {
        if file == LISTS_FILE {
            read.lists = read_lists(storage, folder)?;
        } else if file == STATE_FILE {
            read.open_list = read_open_list(storage, folder);
        } else if let Some(id) = file.strip_suffix(".json").filter(|id| is_id(id)) {
            read.notes.extend(read_note(storage, folder, &file, id)?);
        } else if image_of_file(&file).is_some() {
            read.images.push(file);
        }
    }
    Ok(read)
}

fn read_lists(storage: &dyn NotesStorage, folder: &str) -> anyhow::Result<Vec<NoteList>> {
    let stored = read_stored::<StoredLists>(storage, folder, LISTS_FILE, OTHER_FILE_LIMIT)?;
    Ok(stored
        .map(|stored| checked_lists(folder, stored.lists))
        .transpose()?
        .unwrap_or_default())
}

/// The list open on this machine; `None`, logged, when its file does not read.
fn read_open_list(storage: &dyn NotesStorage, folder: &str) -> Option<String> {
    read_stored::<StoredState>(storage, folder, STATE_FILE, OTHER_FILE_LIMIT)
        .unwrap_or_else(|error| {
            tracing::warn!(folder, error = %format!("{error:#}"), "the list open not read");
            None
        })
        .and_then(|s| s.open_list)
}

/// The note in `file`, whose name is the note's id.
fn read_note(
    storage: &dyn NotesStorage,
    folder: &str,
    file: &str,
    id: &str,
) -> anyhow::Result<Option<Note>> {
    let stored = read_stored::<StoredNote>(storage, folder, file, NOTE_FILE_LIMIT)?;
    Ok(stored.map(|stored| Note {
        id: id.into(),
        ..stored.note
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_are_named_after_their_project() {
        assert!(folder_name("side kyk").starts_with("side-kyk-"));
        assert!(folder_name("Città/casa").starts_with("Citt--casa-"));
        assert!(folder_name("...").starts_with("project-"));
        assert_eq!(folder_name(&"a".repeat(100)).len(), FOLDER_NAME_LIMIT + 7);
    }
}
