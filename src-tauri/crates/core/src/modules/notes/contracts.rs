//! Wire contracts shared with the frontend (`src/modules/notes/model/notes.types.ts`), and the
//! forms notes are stored in.

use serde::{Deserialize, Serialize};

/// The Inbox's book on the wire. No project id is it: ids are 16 hex digits, and before them
/// absolute paths or `wsl:…`.
pub const INBOX_BOOK: &str = "inbox";

/// Whose notes: the Inbox's, or a project's. On the wire a string, `INBOX_BOOK` or the project's
/// id, made a `Book` where the projects are known. Two books are the same when their keys are.
#[derive(Clone, Debug)]
pub enum Book {
    /// Where notes of no project wait to be sorted: one list, never shown, and no done.
    Inbox,
    /// A project's, by its id; its name names the folder made for them.
    Project { id: String, name: String },
}

impl Book {
    /// Its name on the wire.
    pub fn key(&self) -> &str {
        match self {
            Self::Inbox => INBOX_BOOK,
            Self::Project { id, .. } => id,
        }
    }
}

/// Where a move puts its notes, as the frontend names it: a book, or a project made for them,
/// without folder.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BookTarget {
    Book { book: String },
    NewProject { name: String },
}

/// The list of its book a moved note goes to.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ListTarget {
    /// The list the book opens on; the Inbox's only one.
    Open,
    List {
        id: String,
    },
    /// A list made for it, last.
    New {
        name: String,
    },
}

/// One note: a card of plain text in a list of a book.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// The list it is in.
    pub list: String,
    /// Its place among the open notes of its list, lowest on top. Only the order means anything:
    /// a note moved between two others takes a value between theirs.
    pub position: f64,
    pub text: String,
    /// Milliseconds since the Unix epoch, as every time here.
    pub created: u64,
    /// When its text last changed.
    pub edited: u64,
    /// When it was marked done, or `None` while open.
    pub done: Option<u64>,
}

/// A list of notes, by topic.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteList {
    pub id: String,
    pub name: String,
}

/// Every note of a book, its lists in the user's order (at least one), and the list open.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNotes {
    pub lists: Vec<NoteList>,
    /// In no particular order: open notes sort by `position`, done ones by `done`.
    pub notes: Vec<Note>,
    pub open_list: String,
}

/// What a book tells of its notes: a project's card at all projects.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesSummary {
    /// The notes not done.
    pub open: u32,
    pub done: u32,
    /// When the newest change to a note's text was, `None` without notes.
    pub last_edited: Option<u64>,
}

/// A list deleted with its notes, handed back to bring them all back (undo).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedList {
    pub list: NoteList,
    /// Where it was among the lists.
    pub index: u32,
    pub notes: Vec<Note>,
}

/// A note moved, as it is now, and the book it went to: one a project was made for has an id the
/// frontend did not know.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedNote {
    pub to: String,
    pub note: Note,
}

/// A list moved to another project, handed back to undo it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedList {
    /// The books, on the wire.
    pub from: String,
    pub to: String,
    /// The list as it left `from`, brought back there as a deleted list is.
    pub left: DeletedList,
    /// The list of `to` that took its notes.
    pub into: String,
    /// Whether `into` was there before, a list of the same name: undo leaves it.
    pub joined: bool,
}

/// Every stored file says which version of its form it is in.
pub(super) const STORED_VERSION: u8 = 1;

/// `project.json`: which project a folder of notes belongs to.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct StoredProject {
    pub(super) version: u8,
    /// The project's id; before ids, its root, which is a local project's id.
    #[serde(alias = "root")]
    pub(super) id: String,
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
            done: 1,
            last_edited: Some(5),
        };
        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            serde_json::json!({ "open": 2, "done": 1, "lastEdited": 5 })
        );
    }

    #[test]
    fn move_targets_read_as_the_frontend_sends_them() {
        let target = |json| serde_json::from_value::<BookTarget>(json).unwrap();
        assert_eq!(
            target(serde_json::json!({ "kind": "book", "book": "inbox" })),
            BookTarget::Book {
                book: INBOX_BOOK.into()
            }
        );
        assert_eq!(
            target(serde_json::json!({ "kind": "newProject", "name": "Casa" })),
            BookTarget::NewProject {
                name: "Casa".into()
            }
        );
        let list = |json| serde_json::from_value::<ListTarget>(json).unwrap();
        assert_eq!(
            list(serde_json::json!({ "kind": "open" })),
            ListTarget::Open
        );
        assert_eq!(
            list(serde_json::json!({ "kind": "list", "id": "fedcba9876543210" })),
            ListTarget::List {
                id: "fedcba9876543210".into()
            }
        );
        assert_eq!(
            list(serde_json::json!({ "kind": "new", "name": "Spesa" })),
            ListTarget::New {
                name: "Spesa".into()
            }
        );
    }

    #[test]
    fn a_move_tells_where_it_went_and_comes_back_to_be_undone() {
        assert_eq!(
            serde_json::to_value(MovedNote {
                to: INBOX_BOOK.into(),
                note: note()
            })
            .unwrap()["to"],
            "inbox"
        );
        let moved = MovedList {
            from: "0123456789abcdef".into(),
            to: "00112233445566ff".into(),
            left: DeletedList {
                list: NoteList {
                    id: "fedcba9876543210".into(),
                    name: "Release".into(),
                },
                index: 1,
                notes: vec![note()],
            },
            into: "1111111111111111".into(),
            joined: false,
        };
        let json = serde_json::to_value(&moved).unwrap();
        assert_eq!(json["left"]["index"], 1);
        assert_eq!(json["joined"], false);
        assert_eq!(serde_json::from_value::<MovedList>(json).unwrap(), moved);
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
