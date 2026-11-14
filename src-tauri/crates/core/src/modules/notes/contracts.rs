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

/// The formats a note takes: those every webview shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageKind {
    Png,
    Jpeg,
    Gif,
    Webp,
}

impl ImageKind {
    pub const ALL: [Self; 4] = [Self::Png, Self::Jpeg, Self::Gif, Self::Webp];

    /// The extension of its file.
    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }
}

/// An image of a note, kept beside its notes as given, with a thumbnail for the cards.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImage {
    /// Names its files: `<id>.<extension>`, and the thumbnail's `<id>.thumb.png`.
    pub id: String,
    pub kind: ImageKind,
    /// In pixels.
    pub width: u32,
    pub height: u32,
    /// The size of its file.
    pub bytes: u64,
    /// Its marks and the image under them, when it is that image marked; `None` in an image
    /// stored before marks.
    #[serde(default)]
    pub marked: Option<MarkedImage>,
}

impl NoteImage {
    /// The image as given: itself, or the one under its marks.
    pub fn source(&self) -> NoteImage {
        match &self.marked {
            None => self.clone(),
            Some(marked) => NoteImage {
                id: marked.source.id.clone(),
                kind: marked.source.kind,
                width: self.width,
                height: self.height,
                bytes: marked.source.bytes,
                marked: None,
            },
        }
    }

    /// The ids its files are named by: its own, and the image's under its marks.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.id.as_str()).chain(self.marked.as_ref().map(|m| m.source.id.as_str()))
    }

    /// The kind of the image `id` names, if it is this one or the one under its marks.
    pub fn kind_of(&self, id: &str) -> Option<ImageKind> {
        match &self.marked {
            _ if self.id == id => Some(self.kind),
            Some(marked) if marked.source.id == id => Some(marked.source.kind),
            _ => None,
        }
    }
}

/// An image marked: a PNG drawn by the frontend, the image as given under the marks it shows, so
/// they stay editable.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkedImage {
    /// The image as given, as large as the marked one.
    pub source: SourceImage,
    /// In the order they were placed, the last drawn on top.
    pub marks: Vec<Mark>,
}

/// The image under the marks: its file is `<id>.<extension>`, its thumbnail `<id>.thumb.png`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceImage {
    pub id: String,
    pub kind: ImageKind,
    pub bytes: u64,
}

impl SourceImage {
    /// An image as given, kept under marks.
    pub fn of(image: NoteImage) -> Self {
        Self {
            id: image.id,
            kind: image.kind,
            bytes: image.bytes,
        }
    }
}

/// A label on an image, a letter or a text, with a tail pointing at a spot; a tail with no text
/// is a plain arrow. Points in the image's pixels.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    /// The label's middle.
    pub x: u32,
    pub y: u32,
    pub text: String,
    /// Where its tail points, if it has one.
    pub tail: Option<MarkPoint>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarkPoint {
    pub x: u32,
    pub y: u32,
}

/// The note images go to, as the frontend names it: one there, or a new one on top of a list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ImageTarget {
    Note { id: String },
    New { list: String },
}

/// One note: a card of plain text in a list of a book, and its images below the text.
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
    /// In the order they came in; none in a note stored before images.
    #[serde(default)]
    pub images: Vec<NoteImage>,
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

/// How many notes a book has: the open ones on a project's row, all of them before its removal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct NotesCount {
    /// The notes not done.
    pub open: u32,
    pub done: u32,
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

/// A note moved, as it is now, and the book it went to.
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

    #[test]
    fn a_count_uses_the_frontend_field_names() {
        assert_eq!(
            serde_json::to_value(NotesCount { open: 2, done: 1 }).unwrap(),
            serde_json::json!({ "open": 2, "done": 1 })
        );
    }

    fn note() -> Note {
        Note {
            id: "0123456789abcdef".into(),
            list: "fedcba9876543210".into(),
            position: -1.5,
            text: "Try the rail".into(),
            created: 1,
            edited: 2,
            done: None,
            images: Vec::new(),
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
                    "done": null,
                    "images": []
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
    fn list_targets_read_as_the_frontend_sends_them() {
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
    fn an_image_target_reads_as_the_frontend_sends_it() {
        let target = |json| serde_json::from_value::<ImageTarget>(json).unwrap();
        assert_eq!(
            target(serde_json::json!({ "kind": "note", "id": "0123456789abcdef" })),
            ImageTarget::Note {
                id: "0123456789abcdef".into()
            }
        );
        assert_eq!(
            target(serde_json::json!({ "kind": "new", "list": "fedcba9876543210" })),
            ImageTarget::New {
                list: "fedcba9876543210".into()
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
    fn an_image_uses_the_frontend_field_names_and_a_note_before_images_has_none() {
        let image = NoteImage {
            id: "00112233445566ff".into(),
            kind: ImageKind::Jpeg,
            width: 4032,
            height: 3024,
            bytes: 1_008_550,
            marked: None,
        };
        assert_eq!(
            serde_json::to_value(&image).unwrap(),
            serde_json::json!({
                "id": "00112233445566ff",
                "kind": "jpeg",
                "width": 4032,
                "height": 3024,
                "bytes": 1_008_550,
                "marked": null
            })
        );
        let mut before_marks = serde_json::to_value(&image).unwrap();
        before_marks.as_object_mut().unwrap().remove("marked");
        assert_eq!(
            serde_json::from_value::<NoteImage>(before_marks).unwrap(),
            image
        );
        let mut json = serde_json::to_value(StoredNote {
            version: STORED_VERSION,
            note: note(),
        })
        .unwrap();
        json.as_object_mut().unwrap().remove("images");
        assert!(serde_json::from_value::<StoredNote>(json)
            .unwrap()
            .note
            .images
            .is_empty());
    }

    #[test]
    fn a_marked_image_uses_the_frontend_field_names_and_gives_its_source_back() {
        let marked = NoteImage {
            id: "1111111111111111".into(),
            kind: ImageKind::Png,
            width: 800,
            height: 600,
            bytes: 90_000,
            marked: Some(MarkedImage {
                source: SourceImage {
                    id: "00112233445566ff".into(),
                    kind: ImageKind::Jpeg,
                    bytes: 70_000,
                },
                marks: vec![Mark {
                    x: 10,
                    y: 20,
                    text: "A".into(),
                    tail: Some(MarkPoint { x: 30, y: 40 }),
                }],
            }),
        };
        let json = serde_json::to_value(&marked).unwrap();
        assert_eq!(
            json["marked"],
            serde_json::json!({
                "source": { "id": "00112233445566ff", "kind": "jpeg", "bytes": 70_000 },
                "marks": [{ "x": 10, "y": 20, "text": "A", "tail": { "x": 30, "y": 40 } }]
            })
        );
        assert_eq!(serde_json::from_value::<NoteImage>(json).unwrap(), marked);
        let source = marked.source();
        assert_eq!(
            (source.id.as_str(), source.kind, source.bytes, source.width),
            ("00112233445566ff", ImageKind::Jpeg, 70_000, 800)
        );
        assert!(source.marked.is_none());
        assert_eq!(
            marked.ids().collect::<Vec<_>>(),
            ["1111111111111111", "00112233445566ff"]
        );
        assert_eq!(source.ids().collect::<Vec<_>>(), ["00112233445566ff"]);
        assert_eq!(marked.kind_of("1111111111111111"), Some(ImageKind::Png));
        assert_eq!(marked.kind_of("00112233445566ff"), Some(ImageKind::Jpeg));
        assert_eq!(marked.kind_of("2222222222222222"), None);
        assert_eq!(SourceImage::of(source), marked.marked.unwrap().source);
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
