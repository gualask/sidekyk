//! The blocks of the preview: paragraphs, headings, quotes, lists, tables, and the text of a tight
//! list's item.

use pulldown_cmark::{Alignment, BlockQuoteKind, Event, Tag};

use super::super::contracts::{Alert, Align, Block, Inline, ListItem};
use super::code::code_language;
use super::inlines::plain_text;
use super::nesting::Node;
use super::Reader;

impl<'a> Reader<'_, 'a> {
    pub(super) fn blocks(&mut self, nodes: Vec<Node<'a>>) -> Vec<Block> {
        let mut blocks = Vec::new();
        let mut text: Vec<Node> = Vec::new();
        for node in nodes {
            if node.is_inline() {
                text.push(node);
                continue;
            }
            self.plain(&mut text, &mut blocks);
            if let Some(block) = self.block(node) {
                blocks.push(block);
            }
        }
        self.plain(&mut text, &mut blocks);
        blocks
    }

    /// Text met outside a paragraph (a tight list's item) as a block of its own.
    fn plain(&mut self, text: &mut Vec<Node<'a>>, blocks: &mut Vec<Block>) {
        let Some(first) = text.first() else {
            return;
        };
        let line = self.line(first.start());
        let content = self.inlines(std::mem::take(text));
        if !content.is_empty() {
            blocks.push(Block::Plain { line, content });
        }
    }

    fn block(&mut self, node: Node<'a>) -> Option<Block> {
        let line = self.line(node.start());
        let (tag, children) = match node {
            Node::Leaf {
                event: Event::Rule, ..
            } => return Some(Block::Rule { line }),
            // raw HTML, math and anything else not enabled
            Node::Leaf { .. } => return None,
            Node::Element { tag, children, .. } => (tag, children),
        };
        Some(match tag {
            Tag::Paragraph => Block::Paragraph {
                line,
                content: self.inlines(children),
            },
            Tag::Heading { level, .. } => self.heading(line, level as u8, children),
            Tag::BlockQuote(kind) => Block::Quote {
                line,
                alert: kind.map(alert),
                blocks: self.blocks(children),
            },
            Tag::CodeBlock(kind) => self.code_block(line, code_language(kind), &children),
            Tag::List(start) => self.list(line, start, children),
            Tag::Table(align) => self.table(line, align, children),
            // raw HTML, a front matter
            _ => return None,
        })
    }

    /// A heading, with the id its links go to.
    fn heading(&mut self, line: u32, level: u8, children: Vec<Node<'a>>) -> Block {
        let content = self.inlines(children);
        Block::Heading {
            line,
            level,
            id: self.slugger.id(&plain_text(&content)),
            content,
        }
    }

    fn list(&mut self, line: u32, start: Option<u64>, children: Vec<Node<'a>>) -> Block {
        Block::List {
            line,
            start,
            items: children
                .into_iter()
                .filter_map(|item| self.item(item))
                .collect(),
        }
    }

    fn table(&mut self, line: u32, align: Vec<Alignment>, parts: Vec<Node<'a>>) -> Block {
        let mut head = Vec::new();
        let mut rows = Vec::new();
        for part in parts {
            let Node::Element { tag, children, .. } = part else {
                continue;
            };
            match tag {
                Tag::TableHead => head = self.cells(children),
                Tag::TableRow => rows.push(self.cells(children)),
                _ => {}
            }
        }
        Block::Table {
            line,
            align: align.into_iter().map(aligned).collect(),
            head,
            rows,
        }
    }

    fn item(&mut self, node: Node<'a>) -> Option<ListItem> {
        let Node::Element {
            tag: Tag::Item,
            start,
            mut children,
        } = node
        else {
            return None;
        };
        let task = match children.first() {
            Some(Node::Leaf {
                event: Event::TaskListMarker(checked),
                ..
            }) => Some(*checked),
            _ => None,
        };
        if task.is_some() {
            children.remove(0);
        }
        Some(ListItem {
            line: self.line(start),
            task,
            blocks: self.blocks(children),
        })
    }

    fn cells(&mut self, cells: Vec<Node<'a>>) -> Vec<Vec<Inline>> {
        cells
            .into_iter()
            .filter_map(|cell| match cell {
                Node::Element {
                    tag: Tag::TableCell,
                    children,
                    ..
                } => Some(self.inlines(children)),
                _ => None,
            })
            .collect()
    }
}

fn alert(kind: BlockQuoteKind) -> Alert {
    match kind {
        BlockQuoteKind::Note => Alert::Note,
        BlockQuoteKind::Tip => Alert::Tip,
        BlockQuoteKind::Important => Alert::Important,
        BlockQuoteKind::Warning => Alert::Warning,
        BlockQuoteKind::Caution => Alert::Caution,
    }
}

fn aligned(alignment: Alignment) -> Align {
    match alignment {
        Alignment::None => Align::None,
        Alignment::Left => Align::Left,
        Alignment::Center => Align::Center,
        Alignment::Right => Align::Right,
    }
}
