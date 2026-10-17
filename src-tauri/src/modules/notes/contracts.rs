//! Wire contracts shared with the frontend (`src/modules/notes/model/notes.types.ts`), and the
//! forms notes are stored in.

use serde::{Deserialize, Serialize};

/// One note: a card of plain text in a list of a project.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Note {
    pub(crate) id: String,
    /// The list it is in.
    pub(crate) list: String,
    /// Its place among the open notes of its list, lowest on top. Only the order means anything:
    /// a note moved between two others takes a value between theirs.
    pub(crate) position: f64,
    pub(crate) text: String,
    /// Milliseconds since the Unix epoch, as every time here.
    pub(crate) created: u64,
    /// When its text last changed.
    pub(crate) edited: u64,
    /// When it was marked done, or `None` while open.
    pub(crate) done: Option<u64>,
}

/// A list of notes, by topic.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteList {
    pub(crate) id: String,
    pub(crate) name: String,
}

/// Every note of a project, its lists in the user's order (at least one), and the list open.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectNotes {
    pub(crate) lists: Vec<NoteList>,
    /// In no particular order: open notes sort by `position`, done ones by `done`.
    pub(crate) notes: Vec<Note>,
    pub(crate) open_list: String,
}

/// What a project's card at all projects tells of its notes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotesSummary {
    /// The notes not done.
    pub(crate) open: u32,
    /// The first line of the open note written last.
    pub(crate) newest: Option<String>,
}

/// A list deleted with its notes, handed back to bring them all back (undo).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeletedList {
    pub(crate) list: NoteList,
    /// Where it was among the lists.
    pub(crate) index: u32,
    pub(crate) notes: Vec<Note>,
}

/// Every stored file says which version of its form it is in.
pub(super) const STORED_VERSION: u8 = 1;

/// `project.json`: which project a folder of notes belongs to.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct StoredProject {
    pub(super) version: u8,
    pub(super) root: String,
}

/// `<id>.json`: one note.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct StoredNote {
    pub(super) version: u8,
    #[serde(flatten)]
    pub(super) note: Note,
}

/// `lists.json`: the lists, in the user's order.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct StoredLists {
    pub(super) version: u8,
    pub(super) lists: Vec<NoteList>,
}

/// `state.json`: what the panel showed last, kept on this machine only.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredState {
    pub(super) version: u8,
    pub(super) open_list: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note() -> Note {
        Note {
            id: "0123456789abcdef".into(),
            list: "fedcba9876543210".into(),
            position: -1.5,
            text: "Try the rail".into(),
            created: 1,
            edited: 2,
            done: None,
        }
    }

    #[test]
    fn project_notes_serialize_with_the_frontend_field_names() {
        let notes = ProjectNotes {
            lists: vec![NoteList {
                id: "fedcba9876543210".into(),
                name: "General".into(),
            }],
            notes: vec![note()],
            open_list: "fedcba9876543210".into(),
        };
        assert_eq!(
            serde_json::to_value(&notes).unwrap(),
            serde_json::json!({
                "lists": [{ "id": "fedcba9876543210", "name": "General" }],
                "notes": [{
                    "id": "0123456789abcdef",
                    "list": "fedcba9876543210",
                    "position": -1.5,
                    "text": "Try the rail",
                    "created": 1,
                    "edited": 2,
                    "done": null
                }],
                "openList": "fedcba9876543210"
            })
        );
    }

    #[test]
    fn a_deleted_list_goes_and_comes_back_in_the_same_form() {
        let deleted = DeletedList {
            list: NoteList {
                id: "fedcba9876543210".into(),
                name: "Release".into(),
            },
            index: 2,
            notes: vec![Note {
                done: Some(3),
                ..note()
            }],
        };
        let json = serde_json::to_value(&deleted).unwrap();
        assert_eq!(json["index"], 2);
        assert_eq!(json["notes"][0]["done"], 3);
        assert_eq!(
            serde_json::from_value::<DeletedList>(json).unwrap(),
            deleted
        );
    }

    #[test]
    fn a_summary_uses_the_frontend_field_names() {
        let summary = NotesSummary {
            open: 2,
            newest: Some("Try the rail".into()),
        };
        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            serde_json::json!({ "open": 2, "newest": "Try the rail" })
        );
    }

    #[test]
    fn a_stored_note_is_the_note_with_its_version() {
        let stored = StoredNote {
            version: STORED_VERSION,
            note: note(),
        };
        let json = serde_json::to_value(&stored).unwrap();
        assert_eq!(json["version"], 1);
        assert_eq!(json["text"], "Try the rail");
        assert_eq!(serde_json::from_value::<StoredNote>(json).unwrap(), stored);
    }
}
