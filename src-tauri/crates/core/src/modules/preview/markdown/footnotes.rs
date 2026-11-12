//! Footnotes: numbered by their first reference, gathered at the end.

use super::super::contracts::{Block, Footnote, Inline};
use super::Reader;

impl<'a> Reader<'_, 'a> {
    /// A reference to a defined footnote, numbered by the first reference to each.
    pub(super) fn reference(&mut self, label: &str) -> Option<Inline> {
        let label = label.to_lowercase();
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
            number: u32::try_from(index + 1).unwrap_or(u32::MAX),
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
                number: u32::try_from(index + 1).unwrap_or(u32::MAX),
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
