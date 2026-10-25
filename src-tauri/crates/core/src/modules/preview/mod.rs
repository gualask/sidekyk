//! The viewer's previews: a Markdown file as a tree of blocks the frontend renders, its links and
//! images resolved against the project's files. Pure: the text and the tree come from the caller.

mod contracts;
mod markdown;
mod targets;

pub use contracts::{
    Alert, Align, Block, CodeLine, Footnote, Inline, ListItem, MarkdownDocument, Target,
};
pub use markdown::parse_markdown;
pub use targets::{image_type, is_web_url};
