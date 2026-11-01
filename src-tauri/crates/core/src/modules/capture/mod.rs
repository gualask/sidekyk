//! A capture: an area of a display picked over its frozen frame, kept as a new note's image
//! (`notes::prepare_capture`). Reading the display and the window that shows it are each
//! system's (`infrastructure/`).

mod selection;

use serde::Serialize;

pub use selection::{Area, Grip, Handle, PixelRect, Point, Selection, Size};

/// The event that tells the frontend how a capture ended; a cancel tells nothing.
pub const CAPTURE_EVENT: &str = "capture";

/// How a capture ended, for the frontend (`modules/notes/model/notes.types.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CaptureEvent {
    /// An area was picked: `add_capture` makes it a note.
    Taken,
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
        assert_eq!(json(CaptureEvent::Taken), r#"{"kind":"taken"}"#);
        assert_eq!(json(CaptureEvent::Refused), r#"{"kind":"refused"}"#);
        assert_eq!(json(CaptureEvent::Failed), r#"{"kind":"failed"}"#);
    }
}
