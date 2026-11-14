//! A capture: an area of a display picked over its frozen frame, kept as a crop for a note's
//! image (`notes::prepare_capture`). Reading the display and the window that shows it are each
//! system's (`infrastructure/`).

mod area;
mod selection;

use serde::{Deserialize, Serialize};

use crate::modules::notes::{ImageTarget, PreparedImage};

pub use area::{Area, Handle, PixelRect, Point, Size};
pub use selection::{Grip, Selection};

/// An area taken, on its display by the system's id.
#[derive(Clone, Copy, Debug)]
pub struct Taken {
    pub display: u32,
    pub area: Area,
}

/// How a capture ended, as each system's capture tells it.
#[derive(Debug)]
pub enum Outcome {
    /// The area picked, ready for a note, and where it was.
    Captured {
        image: PreparedImage,
        taken: Taken,
    },
    /// `Esc`.
    Cancelled,
    /// The system does not let Sidekyk read the screen; it was asked to.
    NoPermission,
    Failed(anyhow::Error),
}

/// Where a capture goes, as the entry that started it says: the place last chosen for a capture
/// (the global shortcut, the tray, the capture window's +: the page holds it), or a list or a
/// note of a book (Notes' field, a note's "Add capture").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CaptureInto {
    Last,
    Into { book: String, target: ImageTarget },
}

/// The event that tells the frontend how a capture ended; a cancel tells nothing.
pub const CAPTURE_EVENT: &str = "capture";

/// How a capture ended, for the frontend (`modules/notes/model/notes.types.ts`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CaptureEvent {
    /// An area was picked: the crop `crop`, held until a note takes it or it is dropped, its
    /// size, and where the capture goes.
    Taken {
        crop: String,
        width: u32,
        height: u32,
        into: CaptureInto,
    },
    /// The system does not let Sidekyk read the screen.
    Refused,
    Failed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_frontend_reads_how_a_capture_ended() {
        let json = |event| serde_json::to_string(&event).unwrap();
        assert_eq!(
            json(CaptureEvent::Taken {
                crop: "0123456789abcdef".into(),
                width: 640,
                height: 480,
                into: CaptureInto::Last,
            }),
            r#"{"kind":"taken","crop":"0123456789abcdef","width":640,"height":480,"into":{"kind":"last"}}"#
        );
        assert_eq!(json(CaptureEvent::Refused), r#"{"kind":"refused"}"#);
        assert_eq!(json(CaptureEvent::Failed), r#"{"kind":"failed"}"#);
    }

    #[test]
    fn a_capture_goes_where_its_entry_says() {
        let into = |json| serde_json::from_value::<CaptureInto>(json).unwrap();
        assert_eq!(
            into(serde_json::json!({ "kind": "last" })),
            CaptureInto::Last
        );
        assert_eq!(
            into(serde_json::json!({
                "kind": "into",
                "book": "inbox",
                "target": { "kind": "note", "id": "0123456789abcdef" },
            })),
            CaptureInto::Into {
                book: "inbox".into(),
                target: ImageTarget::Note {
                    id: "0123456789abcdef".into()
                },
            }
        );
    }
}
