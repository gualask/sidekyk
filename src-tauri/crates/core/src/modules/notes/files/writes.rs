//! A book's files written after a change, as `files` lays them out.

use super::{note_file, LISTS_FILE, STATE_FILE};
use crate::modules::notes::book::{NoteBook, Touched};
use crate::modules::notes::contracts::{StoredLists, StoredNote, StoredState, STORED_VERSION};
use crate::modules::notes::ports::NotesStorage;

pub(in crate::modules::notes) fn write_json(
    storage: &dyn NotesStorage,
    folder: &str,
    file: &str,
    value: &impl serde::Serialize,
) -> anyhow::Result<()> {
    storage.write(folder, file, &serde_json::to_vec_pretty(value)?)
}

/// The file of what a change touched, as `notes` has it now; a note no longer there is removed.
pub(in crate::modules::notes) fn write_touched(
    storage: &dyn NotesStorage,
    folder: &str,
    notes: &NoteBook,
    touched: Touched,
) -> anyhow::Result<()> {
    match touched {
        Touched::Note(id) => write_note(storage, folder, notes, &id),
        Touched::Lists => write_json(
            storage,
            folder,
            LISTS_FILE,
            &StoredLists {
                version: STORED_VERSION,
                lists: notes.lists.clone(),
            },
        ),
        Touched::State => write_json(
            storage,
            folder,
            STATE_FILE,
            &StoredState {
                version: STORED_VERSION,
                open_list: Some(notes.open_list.clone()),
            },
        ),
    }
}

/// The file of the note `id`, as `notes` has it now; removed when it is no longer there.
fn write_note(
    storage: &dyn NotesStorage,
    folder: &str,
    notes: &NoteBook,
    id: &str,
) -> anyhow::Result<()> {
    match notes.note(id) {
        Some(note) => write_json(
            storage,
            folder,
            &note_file(id),
            &StoredNote {
                version: STORED_VERSION,
                note: note.clone(),
            },
        ),
        None => storage.remove(folder, &note_file(id)),
    }
}
