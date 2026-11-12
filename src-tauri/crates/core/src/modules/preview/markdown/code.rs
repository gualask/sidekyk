//! Code blocks: a Mermaid block as a diagram, any other as its lines as the file has them.

use pulldown_cmark::{CodeBlockKind, Event};

use super::super::contracts::{Block, CodeLine};
use super::nesting::Node;
use super::Reader;

impl<'a> Reader<'_, 'a> {
    /// A code block in Mermaid as a diagram, any other as code.
    pub(super) fn code_block(
        &self,
        line: u32,
        language: Option<String>,
        children: &[Node],
    ) -> Block {
        if language
            .as_deref()
            .is_some_and(|language| language.eq_ignore_ascii_case("mermaid"))
        {
            return Block::Diagram {
                line,
                source: code_text(children),
            };
        }
        Block::Code {
            line,
            language,
            lines: self.code_lines(children),
        }
    }

    /// A code block's lines as the file has them, each from where the block's text starts on it.
    fn code_lines(&self, children: &[Node]) -> Vec<CodeLine> {
        let mut lines: Vec<CodeLine> = Vec::new();
        for offset in children.iter().flat_map(|child| self.piece_starts(child)) {
            let number = self.line(offset);
            if lines.last().is_none_or(|last| last.number < number) {
                lines.push(self.code_line(number, offset));
            }
        }
        lines
    }

    /// Where each line of a text leaf starts in the file, its first from where the leaf does;
    /// none for another node.
    fn piece_starts(&self, child: &Node) -> Vec<usize> {
        let Node::Leaf {
            event: Event::Text(_),
            range,
        } = child
        else {
            return Vec::new();
        };
        let Some(text) = self.text.get(range.clone()) else {
            return Vec::new();
        };
        text.split_inclusive('\n')
            .scan(range.start, |offset, piece| {
                let start = *offset;
                *offset += piece.len();
                Some(start)
            })
            .collect()
    }

    fn code_line(&self, number: u32, offset: usize) -> CodeLine {
        let start = self.line_starts[number as usize - 1];
        let end = self
            .line_starts
            .get(number as usize)
            .map_or(self.text.len(), |next| next - 1);
        let text = &self.text[start..end.max(start)];
        let before = &self.text[start..offset.clamp(start, start + text.len())];
        CodeLine {
            number,
            text: text.to_string(),
            from: u32::try_from(before.encode_utf16().count()).unwrap_or(u32::MAX),
        }
    }
}

/// A code block's language: the first word of a fence's info string, braces and dots trimmed
/// (`{.rust}`); none for an indented block.
pub(super) fn code_language(kind: CodeBlockKind) -> Option<String> {
    match kind {
        CodeBlockKind::Fenced(info) => info
            .split_whitespace()
            .next()
            .map(|word| word.trim_matches(['{', '}', '.']).to_string())
            .filter(|language| !language.is_empty()),
        CodeBlockKind::Indented => None,
    }
}

/// A code block's text as CommonMark reads it: its text events joined, the fence's indentation
/// already left out.
fn code_text(children: &[Node]) -> String {
    children
        .iter()
        .filter_map(|child| match child {
            Node::Leaf {
                event: Event::Text(text),
                ..
            } => Some(text.as_ref()),
            _ => None,
        })
        .collect()
}
