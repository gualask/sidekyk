//! What tests build notes from.

use super::contracts::Note;

/// An open note at the top of `list`, written at time 0, without images; tests change the rest.
pub(crate) fn test_note(id: &str, list: &str, text: &str) -> Note {
    Note {
        id: id.into(),
        list: list.into(),
        position: 0.0,
        text: text.into(),
        created: 0,
        edited: 0,
        done: None,
        images: Vec::new(),
    }
}
