//! What coloring a changed text again starts from: the states kept every `CHECKPOINT_LINES`
//! lines, and where the new text meets the old one again.

use syntect::highlighting::{HighlightState, Highlighter};
use syntect::parsing::{ParseState, ScopeStack, SyntaxReference};
use syntect::util::LinesWithEndings;

use super::super::contracts::LineColors;
use super::Colored;

/// Lines between the states kept, to color a changed text again from the one before its first
/// changed line.
pub(super) const CHECKPOINT_LINES: usize = 64;

/// Where the grammar is before a line: the parser's state and the styles of the scopes open.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct State {
    pub(super) parse: ParseState,
    pub(super) highlight: HighlightState,
}

impl State {
    /// Before the first line of a text in `grammar`.
    pub(super) fn new(grammar: &SyntaxReference, highlighter: &Highlighter) -> Self {
        Self {
            parse: ParseState::new(grammar),
            highlight: HighlightState::new(highlighter, ScopeStack::new()),
        }
    }
}

/// The lines of a coloring, what it kept, and how many lines it went through.
#[derive(Default)]
pub(super) struct Pass {
    pub(super) lines: Vec<LineColors>,
    pub(super) checkpoints: Vec<(usize, State)>,
    pub(super) recolored: usize,
}

impl Pass {
    /// Keeps `state`, before line `index`, when `CHECKPOINT_LINES` went by since the last kept.
    pub(super) fn keep_state(&mut self, index: usize, state: &State) {
        let due = self
            .checkpoints
            .last()
            .is_none_or(|(at, _)| index - at >= CHECKPOINT_LINES);
        if due {
            self.checkpoints.push((index, state.clone()));
        }
    }

    /// Ends with the old text's colors and states from line `index` on (`Unchanged::converged`).
    pub(super) fn join(&mut self, index: usize, (lines, states): Tail<'_>) {
        self.lines.extend_from_slice(lines);
        self.checkpoints.retain(|(at, _)| *at < index);
        self.checkpoints.extend(states);
    }
}

/// The old text's colors and states from a line on, the states numbered as the new text's lines.
type Tail<'a> = (&'a [LineColors], Vec<(usize, State)>);

/// What a new text shares with the one colored before it: its first `prefix` lines and its last
/// `suffix`.
pub(super) struct Unchanged<'a> {
    before: &'a Colored,
    lines_before: usize,
    prefix: usize,
    suffix: usize,
}

impl<'a> Unchanged<'a> {
    pub(super) fn between(before: &'a Colored, lines: &[&str]) -> Option<Self> {
        if before.checkpoints.is_empty() {
            return None;
        }
        let old: Vec<&str> = LinesWithEndings::from(&before.text).collect();
        let prefix = old.iter().zip(lines).take_while(|(a, b)| a == b).count();
        let room = old.len().min(lines.len()) - prefix;
        let suffix = old
            .iter()
            .rev()
            .zip(lines.iter().rev())
            .take(room)
            .take_while(|(a, b)| a == b)
            .count();
        Some(Self {
            before,
            lines_before: old.len(),
            prefix,
            suffix,
        })
    }

    /// Where coloring starts again: the colors before the last state kept before the first line
    /// that changed, the states kept up to it, and that state.
    pub(super) fn restart(&self) -> (Pass, State) {
        let kept = &self.before.checkpoints;
        let usable = kept.partition_point(|(line, _)| *line <= self.prefix);
        let (from, state) = kept[usable - 1].clone();
        let pass = Pass {
            lines: self.before.lines[..from].to_vec(),
            checkpoints: kept[..usable].to_vec(),
            recolored: 0,
        };
        (pass, state)
    }

    /// The old text's colors and states from line `index` of the new text, of `count`, numbered
    /// as the new text's lines, when the state before it is the one kept at the same line of the
    /// old text, `state`: from there on the old colors hold.
    pub(super) fn converged(&self, index: usize, count: usize, state: &State) -> Option<Tail<'a>> {
        if index < count - self.suffix {
            return None;
        }
        let before: &'a Colored = self.before;
        let old_index = index + self.lines_before - count;
        let kept = before
            .checkpoints
            .binary_search_by_key(&old_index, |(line, _)| *line)
            .ok()?;
        if before.checkpoints[kept].1 != *state {
            return None;
        }
        let states = before.checkpoints[kept..]
            .iter()
            .map(|(at, state)| (at - old_index + index, state.clone()))
            .collect();
        Some((&before.lines[old_index..], states))
    }
}
