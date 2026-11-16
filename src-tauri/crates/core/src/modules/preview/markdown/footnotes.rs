//! Footnotes: numbered by their first reference, gathered at the end.

use super::super::contracts::{Block, Footnote, Inline};
use super::nesting::footnote_key;
use super::Reader;

/// The number of the footnote first referred to at `index` (from 0): from 1.
fn number(index: usize) -> u32 {
    u32::try_from(index + 1).unwrap_or(u32::MAX)
}

impl<'a> Reader<'_, 'a> {
    /// A reference to a defined footnote, numbered by the first reference to each.
    pub(super) fn reference(&mut self, label: &str) -> Option<Inline> {
        let label = footnote_key(label);
        let index = match self.notes.iter().position(|(known, _)| *known == label) {
            Some(index) => index,
            None if self.definitions.contains_key(&label) => {
                self.notes.push((label, 0));
                self.notes.len() - 1
            }
            None => return None,
        };
        self.notes[index].1 += 1;
        Some(Inline::FootnoteRef {
            number: number(index),
            nth: self.notes[index].1,
        })
    }

    /// The footnotes referred to, in order; a footnote may refer to a later one.
    pub(super) fn footnotes(&mut self) -> Option<Block> {
        let mut notes = Vec::new();
        let mut index = 0;
        while let Some((label, _)) = self.notes.get(index) {
            let (start, children) = self
                .definitions
                .remove(label)
                .expect("only defined footnotes are numbered");
            notes.push(Footnote {
                number: number(index),
                line: self.line(start),
                references: 0,
                blocks: self.blocks(children),
            });
            index += 1;
        }
        for (note, (_, references)) in notes.iter_mut().zip(&self.notes) {
            note.references = *references;
        }
        let line = notes.first()?.line;
        Some(Block::Footnotes { line, notes })
    }
}
