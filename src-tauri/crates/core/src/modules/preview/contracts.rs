//! Wire contracts shared with the frontend (`src/modules/repository/model/repository.types.ts`).

use serde::{Deserialize, Serialize};

/// A Markdown file as its preview shows it: its blocks in order, the footnotes last.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocument {
    pub blocks: Vec<Block>,
    /// The file was larger than `MAX_FILE_BYTES`: its first part only.
    pub truncated: bool,
}

/// A block, with the file's line it starts on (from 1), by which a switch to the code keeps the
/// place.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Block {
    Paragraph {
        line: u32,
        content: Vec<Inline>,
    },
    /// The text of a tight list's item: a paragraph without a paragraph's spacing.
    Plain {
        line: u32,
        content: Vec<Inline>,
    },
    Heading {
        line: u32,
        level: u8,
        /// Its element's id, prefixed (`user-content-`) so it never is one of the app's own.
        id: String,
        content: Vec<Inline>,
    },
    Quote {
        line: u32,
        /// GitHub's `> [!NOTE]` and its kin.
        alert: Option<Alert>,
        blocks: Vec<Block>,
    },
    List {
        line: u32,
        /// The first number of an ordered list; none for bullets.
        start: Option<u64>,
        items: Vec<ListItem>,
    },
    Code {
        line: u32,
        language: Option<String>,
        lines: Vec<CodeLine>,
    },
    Table {
        line: u32,
        align: Vec<Align>,
        head: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
    },
    Rule {
        line: u32,
    },
    /// The footnotes, gathered at the end in the order they are first referenced.
    Footnotes {
        line: u32,
        notes: Vec<Footnote>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    pub line: u32,
    /// A task list's item: checked or not.
    pub task: Option<bool>,
    pub blocks: Vec<Block>,
}

/// A line of a code block as the file has it, so its syntax colors (and their check) are the
/// file's own: the code starts after `from` UTF-16 units (a fence inside a list is indented).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLine {
    pub number: u32,
    pub text: String,
    pub from: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Footnote {
    pub number: u32,
    pub line: u32,
    /// How many times the text refers to it, each reference with a link back.
    pub references: u32,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Alert {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    None,
    Left,
    Center,
    Right,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Inline {
    Text {
        text: String,
    },
    Code {
        text: String,
    },
    Emphasis {
        content: Vec<Inline>,
    },
    Strong {
        content: Vec<Inline>,
    },
    Strikethrough {
        content: Vec<Inline>,
    },
    /// A link; with no target (a scheme not allowed), its text alone.
    Link {
        target: Option<Target>,
        title: Option<String>,
        content: Vec<Inline>,
    },
    Image {
        target: Option<Target>,
        alt: String,
        title: Option<String>,
    },
    Break,
    /// The `nth` reference (from 1) to footnote `number`.
    FootnoteRef {
        number: u32,
        nth: u32,
    },
}

/// Where a link or an image leads, resolved here so the frontend never parses a URL.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    /// An element of the same document, by its id.
    Anchor { id: String },
    /// A file of the project's tree (for an image, an image), with an element to scroll to.
    File {
        path: String,
        anchor: Option<String>,
    },
    /// A path inside the project that is not a file of its tree.
    Missing { path: String },
    /// `http`, `https` or `mailto`: opened outside the app; an image is never loaded from it.
    Web { url: String },
    /// An image written into the file (`data:image/…`).
    Data { url: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_serializes_with_the_frontend_field_names() {
        let document = MarkdownDocument {
            blocks: vec![
                Block::Heading {
                    line: 1,
                    level: 1,
                    id: "user-content-title".into(),
                    content: vec![Inline::Text {
                        text: "Title".into(),
                    }],
                },
                Block::List {
                    line: 3,
                    start: None,
                    items: vec![ListItem {
                        line: 3,
                        task: Some(true),
                        blocks: vec![Block::Plain {
                            line: 3,
                            content: vec![Inline::Link {
                                target: Some(Target::File {
                                    path: "docs/a.md".into(),
                                    anchor: None,
                                }),
                                title: None,
                                content: vec![Inline::FootnoteRef { number: 1, nth: 1 }],
                            }],
                        }],
                    }],
                },
                Block::Code {
                    line: 5,
                    language: Some("rust".into()),
                    lines: vec![CodeLine {
                        number: 6,
                        text: "  fn main() {}".into(),
                        from: 2,
                    }],
                },
                Block::Quote {
                    line: 8,
                    alert: Some(Alert::Note),
                    blocks: vec![],
                },
            ],
            truncated: false,
        };
        assert_eq!(
            serde_json::to_value(&document).unwrap(),
            serde_json::json!({
                "blocks": [
                    {
                        "kind": "heading", "line": 1, "level": 1, "id": "user-content-title",
                        "content": [{ "kind": "text", "text": "Title" }]
                    },
                    {
                        "kind": "list", "line": 3, "start": null,
                        "items": [{
                            "line": 3, "task": true,
                            "blocks": [{
                                "kind": "plain", "line": 3,
                                "content": [{
                                    "kind": "link",
                                    "target": { "kind": "file", "path": "docs/a.md", "anchor": null },
                                    "title": null,
                                    "content": [{ "kind": "footnoteRef", "number": 1, "nth": 1 }]
                                }]
                            }]
                        }]
                    },
                    {
                        "kind": "code", "line": 5, "language": "rust",
                        "lines": [{ "number": 6, "text": "  fn main() {}", "from": 2 }]
                    },
                    { "kind": "quote", "line": 8, "alert": "note", "blocks": [] }
                ],
                "truncated": false
            })
        );
    }
}
