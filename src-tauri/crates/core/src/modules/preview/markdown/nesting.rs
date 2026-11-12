//! pulldown-cmark's events, with their byte ranges, nested by their tags into nodes: a tag with
//! what it holds, or a leaf. Footnote definitions are taken out, to go to the end.

use std::collections::HashMap;
use std::ops::Range;

use pulldown_cmark::{Event, Options, Parser, Tag};

/// CommonMark with GitHub's tables, strikethrough, task lists, footnotes and alerts, and a YAML
/// front matter to hide.
const OPTIONS: Options = Options::ENABLE_TABLES
    .union(Options::ENABLE_STRIKETHROUGH)
    .union(Options::ENABLE_TASKLISTS)
    .union(Options::ENABLE_FOOTNOTES)
    .union(Options::ENABLE_GFM)
    .union(Options::ENABLE_YAML_STYLE_METADATA_BLOCKS);

/// An event with what it holds: a tag with its children, or a leaf.
pub(super) enum Node<'a> {
    Element {
        tag: Tag<'a>,
        start: usize,
        children: Vec<Node<'a>>,
    },
    Leaf {
        event: Event<'a>,
        range: Range<usize>,
    },
}

impl Node<'_> {
    pub(super) fn start(&self) -> usize {
        match self {
            Node::Element { start, .. } => *start,
            Node::Leaf { range, .. } => range.start,
        }
    }

    /// Whether it belongs in a line of text, as a tight list's item holds it with no paragraph.
    pub(super) fn is_inline(&self) -> bool {
        match self {
            Node::Element { tag, .. } => matches!(
                tag,
                Tag::Emphasis
                    | Tag::Strong
                    | Tag::Strikethrough
                    | Tag::Link { .. }
                    | Tag::Image { .. }
            ),
            Node::Leaf { event, .. } => matches!(
                event,
                Event::Text(_)
                    | Event::Code(_)
                    | Event::InlineHtml(_)
                    | Event::FootnoteReference(_)
                    | Event::SoftBreak
                    | Event::HardBreak
            ),
        }
    }
}

/// Footnote definitions by their label (case ignored, as GitHub): where it starts, what it holds.
pub(super) type Definitions<'a> = HashMap<String, (usize, Vec<Node<'a>>)>;

/// Tags nested deeper are left out, what they hold kept in the deepest: the tree is walked and
/// dropped recursively, and 10,000 quotes one in the other would overflow the stack.
const MAX_DEPTH: usize = 48;

/// The events nested by their tags; footnote definitions taken out, the first of a label kept.
pub(super) fn nest(text: &str) -> (Vec<Node<'_>>, Definitions<'_>) {
    let mut open = Open::new();
    let mut root = Vec::new();
    let mut definitions = Definitions::new();
    let mut too_deep = 0usize;
    for (event, range) in Parser::new_ext(text, OPTIONS).into_offset_iter() {
        let node = match event {
            Event::Start(_) if open.len() == MAX_DEPTH => {
                too_deep += 1;
                None
            }
            Event::End(_) if too_deep > 0 => {
                too_deep -= 1;
                None
            }
            Event::Start(tag) => {
                open.push((tag, range.start, Vec::new()));
                None
            }
            Event::End(_) => close(&mut open, &mut definitions),
            event => Some(Node::Leaf { event, range }),
        };
        let Some(node) = node else {
            continue;
        };
        match open.last_mut() {
            Some((_, _, children)) => children.push(node),
            None => root.push(node),
        }
    }
    (root, definitions)
}

/// The tags open while nesting, the outermost first: each with where it starts and its children
/// so far.
type Open<'a> = Vec<(Tag<'a>, usize, Vec<Node<'a>>)>;

/// The element of the innermost tag open, which just ended; a footnote definition goes to
/// `definitions` instead, the first of a label kept.
fn close<'a>(open: &mut Open<'a>, definitions: &mut Definitions<'a>) -> Option<Node<'a>> {
    let (tag, start, children) = open.pop()?;
    if let Tag::FootnoteDefinition(label) = &tag {
        definitions
            .entry(label.to_lowercase())
            .or_insert((start, children));
        return None;
    }
    Some(Node::Element {
        tag,
        start,
        children,
    })
}
