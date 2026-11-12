//! A line where a search in contents found the text, as the palette lists it: trimmed, cut around
//! its first match when long, with where the text is in it in UTF-16 units.

use std::ops::Range;

use grep_matcher::Matcher;
use grep_regex::RegexMatcher;

use super::contracts::{ContentLine, Highlight};

/// A line's text sent at most, in characters, around its first match.
const MAX_LINE_CHARS: usize = 300;

/// Characters kept before a long line's first match.
const CHARS_BEFORE: usize = 40;

/// A matching line as the palette lists it: without its end of line and its indentation, cut
/// around its first match when long, with where the text is in it.
pub(super) fn content_line(matcher: &RegexMatcher, number: u32, bytes: &[u8]) -> ContentLine {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    let Ok(line) = std::str::from_utf8(bytes) else {
        return lossy_line(number, bytes);
    };
    let matches = match_ranges(matcher, line);
    let indent = line.len() - line.trim_start().len();
    let first = matches.first().map_or(indent, |found| found.start);
    let (start, end) = shown_range(line, indent, first);
    let before = if start > indent { "…" } else { "" };
    let after = if end < line.len() { "…" } else { "" };

    // UTF-16 offsets, as JavaScript counts, in the text sent
    let lead = before.encode_utf16().count();
    let offset = |at: usize| (lead + line[start..at].encode_utf16().count()) as u32;
    let highlights = matches
        .into_iter()
        .filter(|found| found.end > start && found.start < end)
        .map(|found| -> Highlight { [offset(found.start.max(start)), offset(found.end.min(end))] })
        .collect();
    ContentLine {
        number,
        text: format!("{before}{}{after}", &line[start..end]),
        highlights,
    }
}

/// A line that is not UTF-8: shown as it can be, nothing to point at.
fn lossy_line(number: u32, bytes: &[u8]) -> ContentLine {
    let text: String = String::from_utf8_lossy(bytes)
        .trim_start()
        .chars()
        .take(MAX_LINE_CHARS)
        .collect();
    ContentLine {
        number,
        text,
        highlights: Vec::new(),
    }
}

/// Where the text is in `line`, in bytes.
fn match_ranges(matcher: &RegexMatcher, line: &str) -> Vec<Range<usize>> {
    let mut matches = Vec::new();
    let _ = matcher.find_iter(line.as_bytes(), |found| {
        matches.push(found.start()..found.end());
        true
    });
    matches
}

/// The part of `line` shown, in bytes: from `CHARS_BEFORE` characters before `first` (its first
/// match), never in its indentation, `MAX_LINE_CHARS` at most.
fn shown_range(line: &str, indent: usize, first: usize) -> (usize, usize) {
    let start = line[..first]
        .char_indices()
        .rev()
        .nth(CHARS_BEFORE - 1)
        .map_or(0, |(at, _)| at)
        .max(indent);
    let end = line[start..]
        .char_indices()
        .nth(MAX_LINE_CHARS)
        .map_or(line.len(), |(at, _)| start + at);
    (start, end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use grep_regex::RegexMatcherBuilder;

    fn needle() -> RegexMatcher {
        RegexMatcherBuilder::new()
            .fixed_strings(true)
            .build("needle")
            .unwrap()
    }

    #[test]
    fn a_long_line_is_cut_around_its_first_match() {
        let line = format!("{}needle{}", "x".repeat(100), "y".repeat(400));
        let found = content_line(&needle(), 1, line.as_bytes());
        assert!(found.text.starts_with('…') && found.text.ends_with('…'));
        assert_eq!(found.text.chars().count(), MAX_LINE_CHARS + 2);
        // "…" and the 40 characters kept before the match
        assert_eq!(found.highlights, [[41, 47]]);
    }

    #[test]
    fn highlights_count_utf16_units() {
        let found = content_line(&needle(), 1, "é𝒳 needle\n".as_bytes());
        assert_eq!(found.highlights, [[4, 10]]);
    }
}
