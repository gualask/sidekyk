//! One line colored: its spans by tone, from the state the line above left.

use syntect::highlighting::{Highlighter, RangedHighlightIterator};
use syntect::parsing::SyntaxSet;

use super::super::contracts::{LineColors, Tone};
use super::incremental::State;
use super::tones::tone_of;
use super::{line_check, SYNTAXES};

/// Longer lines (minified code) keep the text's color, and the lines below carry on from the state
/// above, as VS Code does past `editor.maxTokenizationLineLength`: past ~4,000 bytes a grammar's
/// patterns slow down sharply (a minified line of 4,000 bytes 29 ms, 16,000 260 ms, 32,000 1.9 s).
pub(super) const MAX_COLORED_LINE_BYTES: usize = 4_000;

/// One line's colors from `state`, which it moves past the line; `None` when the grammar fails.
fn color_line(
    line: &str,
    shown: &str,
    state: &mut State,
    highlighter: &Highlighter,
    syntaxes: &SyntaxSet,
) -> Option<Vec<(u32, u32, Tone)>> {
    let ops = state.parse.parse_line(line, syntaxes).ok()?;
    let mut spans: Vec<(u32, u32, Tone)> = Vec::new();
    let mut at = 0;
    for (style, part, range) in
        RangedHighlightIterator::new(&mut state.highlight, &ops, line, highlighter)
    {
        // the newline belongs to no line shown
        let part = &part[..range.end.min(shown.len()).saturating_sub(range.start)];
        let units = part.encode_utf16().count() as u32;
        if let Some(tone) = tone_of(style.foreground).filter(|_| units > 0) {
            push_span(&mut spans, at, units, tone);
        }
        at += units;
    }
    Some(spans)
}

/// `units` in `tone` from `at`, joined to the last span when it goes on from it in that tone.
fn push_span(spans: &mut Vec<(u32, u32, Tone)>, at: u32, units: u32, tone: Tone) {
    match spans.last_mut() {
        Some((_, end, last)) if *end == at && *last == tone => *end += units,
        _ => spans.push((at, at + units, tone)),
    }
}

/// The colors of `line`, with its newline, from `state`; none past `MAX_COLORED_LINE_BYTES`.
/// `None` when the grammar fails on it.
pub(super) fn line_colors(
    line: &str,
    state: &mut State,
    highlighter: &Highlighter,
) -> Option<LineColors> {
    if line.len() > MAX_COLORED_LINE_BYTES {
        return Some(uncolored(line));
    }
    let shown = line.strip_suffix('\n').unwrap_or(line);
    let spans = color_line(line, shown, state, highlighter, &SYNTAXES)?;
    Some(LineColors {
        check: line_check(shown),
        spans,
    })
}

/// A line, with its newline, in the text's color.
pub(super) fn uncolored(line: &str) -> LineColors {
    LineColors {
        check: line_check(line.strip_suffix('\n').unwrap_or(line)),
        spans: Vec::new(),
    }
}
