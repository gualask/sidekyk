//! A text's colors from bat's grammars (two-face, through syntect): the grammar is picked by the
//! file's name, its extension, then its first line (`#!/usr/bin/env bash`). Lines are read one
//! after the other, each from the state the one above left, as a TextMate grammar is.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use syntect::highlighting::{
    Color, HighlightState, Highlighter, RangedHighlightIterator, ScopeSelectors, StyleModifier,
    Theme, ThemeItem, ThemeSettings,
};
use syntect::parsing::{ParseState, ScopeStack, SyntaxReference, SyntaxSet};
use syntect::util::LinesWithEndings;

use super::cache::{Coloring, Lines};
use super::contracts::{LineColors, Tone};

/// Longer lines (minified code) keep the text's color, and the lines below carry on from the state
/// above, as VS Code does past `editor.maxTokenizationLineLength`: past ~4,000 bytes a grammar's
/// patterns slow down sharply (a minified line of 4,000 bytes 29 ms, 16,000 260 ms, 32,000 1.9 s).
const MAX_COLORED_LINE_BYTES: usize = 4_000;

/// Coloring stops after this long, the lines left keeping the text's color: some grammars crawl on
/// some texts. The largest source file of Zed's clone (885 KiB) takes 0.64 s.
const MAX_COLORING_TIME: Duration = Duration::from_secs(2);

/// Loaded once, the first time a file is colored (~2 ms, ~4 MB).
static SYNTAXES: LazyLock<SyntaxSet> = LazyLock::new(two_face::syntax::extra_newlines);
static THEME: LazyLock<Theme> = LazyLock::new(tone_theme);

/// Tones in theme order: a theme color's red channel is its tone's index here plus one, 0 the
/// text's own color.
const TONES: [Tone; 17] = [
    Tone::Comment,
    Tone::String,
    Tone::Escape,
    Tone::Literal,
    Tone::Constant,
    Tone::Keyword,
    Tone::Operator,
    Tone::Function,
    Tone::Type,
    Tone::Tag,
    Tone::Attribute,
    Tone::Property,
    Tone::Parameter,
    Tone::Title,
    Tone::Link,
    Tone::Inserted,
    Tone::Deleted,
];

/// The scopes each tone takes, as One Dark folds TextMate scopes. Where several match, the most
/// specific wins (`constant.character.escape` inside a `string`).
const TONE_SCOPES: &[(&str, Tone)] = &[
    ("comment", Tone::Comment),
    ("string, markup.raw", Tone::String),
    ("constant.character.escape", Tone::Escape),
    (
        "constant.numeric, constant.language, string.regexp, variable.language",
        Tone::Literal,
    ),
    (
        "constant.other, constant.character, support.constant, variable.other.constant, \
         entity.name.constant",
        Tone::Constant,
    ),
    ("keyword, storage", Tone::Keyword),
    ("keyword.operator", Tone::Operator),
    (
        "entity.name.function, support.function, variable.function",
        Tone::Function,
    ),
    (
        "entity.name.type, entity.name.class, entity.name.struct, entity.name.enum, \
         entity.name.trait, entity.name.interface, entity.other.inherited-class, support.type, \
         support.class, storage.type.primitive",
        Tone::Type,
    ),
    ("entity.name.tag", Tone::Tag),
    (
        "entity.other.attribute-name, meta.annotation, meta.decorator",
        Tone::Attribute,
    ),
    (
        "support.type.property-name, meta.mapping.key string, variable.other.member, \
         variable.other.property, entity.name.key",
        Tone::Property,
    ),
    ("variable.parameter", Tone::Parameter),
    ("markup.heading, entity.name.section", Tone::Title),
    ("markup.underline.link, string.other.link", Tone::Link),
    ("markup.inserted", Tone::Inserted),
    ("markup.deleted", Tone::Deleted),
];

fn tone_color(tone: Tone) -> Color {
    let index = TONES.iter().position(|&t| t == tone).unwrap_or(0);
    Color {
        r: index as u8 + 1,
        g: 0,
        b: 0,
        a: 0xFF,
    }
}

fn tone_of(color: Color) -> Option<Tone> {
    (color.r as usize).checked_sub(1).map(|index| TONES[index])
}

/// A theme whose colors are tones: syntect's own scope matching picks them.
fn tone_theme() -> Theme {
    Theme {
        name: None,
        author: None,
        settings: ThemeSettings {
            foreground: Some(Color {
                r: 0,
                g: 0,
                b: 0,
                a: 0xFF,
            }),
            ..ThemeSettings::default()
        },
        scopes: TONE_SCOPES
            .iter()
            .map(|&(scopes, tone)| ThemeItem {
                scope: ScopeSelectors::from_str(scopes).expect("valid scope selectors"),
                style: StyleModifier {
                    foreground: Some(tone_color(tone)),
                    background: None,
                    font_style: None,
                },
            })
            .collect(),
    }
}

/// FNV-1a over the line's UTF-16 units: the frontend hashes its own text the same way.
pub(crate) fn line_check(line: &str) -> u32 {
    line.encode_utf16().fold(0x811c_9dc5, |hash: u32, unit| {
        (hash ^ u32::from(unit)).wrapping_mul(0x0100_0193)
    })
}

/// The grammar for a file: by its whole name (`Makefile`, `.gitignore`), its extension, then its
/// first line; none for plain text.
fn grammar_for<'a>(syntaxes: &'a SyntaxSet, path: &str, text: &str) -> Option<&'a SyntaxReference> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let extension = name.rsplit_once('.').map(|(_, extension)| extension);
    syntaxes
        .find_syntax_by_extension(name)
        .or_else(|| extension.and_then(|e| syntaxes.find_syntax_by_extension(e)))
        .or_else(|| syntaxes.find_syntax_by_first_line(text.lines().next().unwrap_or("")))
        .filter(|syntax| syntax.name != "Plain Text")
}

/// Lines between the states kept, to color a changed text again from the one before its first
/// changed line.
const CHECKPOINT_LINES: usize = 64;

/// Where the grammar is before a line: the parser's state and the styles of the scopes open.
#[derive(Clone, PartialEq, Eq)]
struct State {
    parse: ParseState,
    highlight: HighlightState,
}

/// A text colored: each line's colors, and what coloring it again after a change starts from.
pub(crate) struct Colored {
    lines: Lines,
    text: String,
    /// The grammar's name; none for a text without one.
    grammar: Option<String>,
    /// The state before some lines, about every `CHECKPOINT_LINES` of those colored, in order.
    checkpoints: Vec<(usize, State)>,
    /// The lines this coloring went through; the others came from the text before.
    pub(super) recolored: usize,
}

impl Coloring for Colored {
    fn lines(&self) -> &Lines {
        &self.lines
    }
}

/// The lines of a coloring, what it kept, and how many lines it went through.
struct Pass {
    lines: Vec<LineColors>,
    checkpoints: Vec<(usize, State)>,
    recolored: usize,
}

/// What a new text shares with the one colored before it: its first `prefix` lines and its last
/// `suffix`.
struct Unchanged<'a> {
    before: &'a Colored,
    lines_before: usize,
    prefix: usize,
    suffix: usize,
}

impl<'a> Unchanged<'a> {
    fn between(before: &'a Colored, lines: &[&str]) -> Option<Self> {
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

    /// Where line `index` of the new text, of `count`, was in the old one, with the state kept
    /// there, when that state is `state`: from there on the old colors hold.
    fn converged(&self, index: usize, count: usize, state: &State) -> Option<(usize, usize)> {
        if index < count - self.suffix {
            return None;
        }
        let old_index = index + self.lines_before - count;
        let kept = self
            .before
            .checkpoints
            .binary_search_by_key(&old_index, |(line, _)| *line)
            .ok()?;
        (self.before.checkpoints[kept].1 == *state).then_some((old_index, kept))
    }
}

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
            match spans.last_mut() {
                Some((_, end, last)) if *end == at && *last == tone => *end += units,
                _ => spans.push((at, at + units, tone)),
            }
        }
        at += units;
    }
    Some(spans)
}

/// The colors of each line of `text`, or `None` when `cancelled` is set before the end. With the
/// colors of the text `before` it, as VS Code does: from the last state kept before the first line
/// that changed, and only until the state, past the change, is again one kept there. A text with no
/// grammar has no lines; a line a grammar fails on, and every line after it, no colors, as the
/// lines left when coloring takes too long.
pub(super) fn color_text(
    path: &str,
    text: String,
    before: Option<&Colored>,
    cancelled: &AtomicBool,
) -> Option<Colored> {
    color_within(path, text, before, cancelled, MAX_COLORING_TIME)
}

fn color_within(
    path: &str,
    text: String,
    before: Option<&Colored>,
    cancelled: &AtomicBool,
    time: Duration,
) -> Option<Colored> {
    let grammar = grammar_for(&SYNTAXES, path, &text);
    let pass = match grammar {
        Some(grammar) => color_lines(path, &text, grammar, before, cancelled, time)?,
        None => Pass {
            lines: Vec::new(),
            checkpoints: Vec::new(),
            recolored: 0,
        },
    };
    Some(Colored {
        lines: Arc::new(pass.lines),
        text,
        grammar: grammar.map(|grammar| grammar.name.clone()),
        checkpoints: pass.checkpoints,
        recolored: pass.recolored,
    })
}

fn color_lines(
    path: &str,
    text: &str,
    grammar: &SyntaxReference,
    before: Option<&Colored>,
    cancelled: &AtomicBool,
    time: Duration,
) -> Option<Pass> {
    let started = Instant::now();
    let highlighter = Highlighter::new(&THEME);
    let all: Vec<&str> = LinesWithEndings::from(text).collect();
    let unchanged = before
        .filter(|before| before.grammar.as_deref() == Some(grammar.name.as_str()))
        .and_then(|before| Unchanged::between(before, &all));
    let (mut lines, mut checkpoints, mut state) = match &unchanged {
        Some(unchanged) => {
            let kept = &unchanged.before.checkpoints;
            let usable = kept.partition_point(|(line, _)| *line <= unchanged.prefix);
            let (from, state) = kept[usable - 1].clone();
            let lines = unchanged.before.lines[..from].to_vec();
            (lines, kept[..usable].to_vec(), state)
        }
        None => (
            Vec::new(),
            Vec::new(),
            State {
                parse: ParseState::new(grammar),
                highlight: HighlightState::new(&highlighter, ScopeStack::new()),
            },
        ),
    };

    let restarted = lines.len();
    let mut stopped = false;
    for (index, &line) in all.iter().enumerate().skip(restarted) {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        if !stopped && started.elapsed() > time {
            tracing::debug!(path, line = index + 1, "coloring stopped, too long");
            stopped = true;
        }
        if !stopped {
            let due = checkpoints
                .last()
                .is_none_or(|(at, _)| index - at >= CHECKPOINT_LINES);
            if due {
                checkpoints.push((index, state.clone()));
            }
            if let Some(unchanged) = &unchanged {
                if let Some((old_index, kept)) = unchanged.converged(index, all.len(), &state) {
                    let before = unchanged.before;
                    lines.extend_from_slice(&before.lines[old_index..]);
                    checkpoints.retain(|(at, _)| *at < index);
                    checkpoints.extend(
                        before.checkpoints[kept..]
                            .iter()
                            .map(|(at, state)| (at - old_index + index, state.clone())),
                    );
                    return Some(Pass {
                        lines,
                        checkpoints,
                        recolored: index - restarted,
                    });
                }
            }
        }
        let shown = line.strip_suffix('\n').unwrap_or(line);
        let mut spans = Vec::new();
        if !stopped && line.len() <= MAX_COLORED_LINE_BYTES {
            match color_line(line, shown, &mut state, &highlighter, &SYNTAXES) {
                Some(colored) => spans = colored,
                None => stopped = true,
            }
        }
        lines.push(LineColors {
            check: line_check(shown),
            spans,
        });
    }
    Some(Pass {
        lines,
        checkpoints,
        recolored: all.len() - restarted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn colored(path: &str, text: &str) -> Vec<LineColors> {
        let colored = color_text(path, text.into(), None, &AtomicBool::new(false)).unwrap();
        colored.lines.to_vec()
    }

    fn colored_after(path: &str, text: &str, before: &Colored) -> Colored {
        color_text(path, text.into(), Some(before), &AtomicBool::new(false)).unwrap()
    }

    /// The parts of a line with each tone, as text.
    fn toned(text: &str, colors: &LineColors) -> Vec<(String, Tone)> {
        let units: Vec<u16> = text.encode_utf16().collect();
        colors
            .spans
            .iter()
            .map(|&(start, end, tone)| {
                let part = String::from_utf16(&units[start as usize..end as usize]).unwrap();
                (part, tone)
            })
            .collect()
    }

    #[test]
    fn every_tone_has_its_own_color() {
        for tone in TONES {
            assert_eq!(tone_of(tone_color(tone)), Some(tone));
        }
        assert_eq!(tone_of(THEME.settings.foreground.unwrap()), None);
    }

    #[test]
    fn a_rust_line_takes_its_tones_at_utf16_offsets() {
        let line = r#"fn é() { let s = "hi\n"; } // done"#;
        let lines = colored("src/main.rs", line);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].check, line_check(line));
        let parts = toned(line, &lines[0]);
        for expected in [
            ("fn".to_string(), Tone::Keyword),
            ("é".to_string(), Tone::Function),
            ("let".to_string(), Tone::Keyword),
            ("\\n".to_string(), Tone::Escape),
            ("// done".to_string(), Tone::Comment),
        ] {
            assert!(parts.contains(&expected), "{expected:?} in {parts:?}");
        }
        // a string's quotes and text are one part, around its escape
        assert!(
            parts.contains(&("\"hi".to_string(), Tone::String)),
            "{parts:?}"
        );
    }

    #[test]
    fn a_comment_carries_over_to_the_lines_below() {
        let text = "/* one\n two */ let x = 1;\n";
        let lines = colored("a.js", text);
        assert_eq!(lines.len(), 2);
        assert_eq!(
            toned(" two */ let x = 1;", &lines[1])[0],
            (" two */".into(), Tone::Comment)
        );
    }

    #[test]
    fn grammars_are_found_by_name_extension_or_first_line() {
        let syntaxes = &*SYNTAXES;
        let name =
            |path: &str, text: &str| grammar_for(syntaxes, path, text).map(|s| s.name.clone());
        assert_eq!(name("Makefile", "all:\n"), Some("Makefile".into()));
        assert_eq!(name("web/.gitignore", "dist\n"), Some("Git Ignore".into()));
        assert_eq!(name("src/app.TSX", ""), Some("TypeScriptReact".into()));
        assert_eq!(
            name("bin/deploy", "#!/usr/bin/env bash\necho hi\n"),
            Some("Bourne Again Shell (bash)".into())
        );
        assert_eq!(name("notes.txt", "hello\n"), None);
        assert_eq!(name("LICENSE", "MIT\n"), None);
    }

    #[test]
    fn a_text_without_a_grammar_has_no_colors() {
        assert!(colored("notes.unknownext", "hello\nworld\n").is_empty());
    }

    #[test]
    fn a_line_too_long_keeps_the_text_color_and_the_next_line_its_own() {
        let long = format!("let a = \"{}\";", "x".repeat(MAX_COLORED_LINE_BYTES));
        let text = format!("{long}\nlet b = 1;\n");
        let lines = colored("a.js", &text);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].spans.is_empty());
        assert_eq!(lines[0].check, line_check(&long));
        assert!(toned("let b = 1;", &lines[1]).contains(&("let".into(), Tone::Keyword)));
    }

    #[test]
    fn lines_past_the_time_keep_the_text_color() {
        let text = "let a = 1;\nlet b = 2;\n";
        let colored = color_within(
            "a.js",
            text.into(),
            None,
            &AtomicBool::new(false),
            Duration::ZERO,
        )
        .unwrap();
        let lines = &colored.lines;
        assert_eq!(lines.len(), 2);
        assert!(lines.iter().all(|line| line.spans.is_empty()));
        assert_eq!(lines[1].check, line_check("let b = 2;"));
    }

    #[test]
    fn a_cancelled_run_gives_nothing() {
        assert!(color_text("a.rs", "fn a() {}\n".into(), None, &AtomicBool::new(true)).is_none());
    }

    /// A Rust file of `blocks` functions, ten lines each, with a block comment in each.
    fn rust_file(blocks: usize) -> Vec<String> {
        (0..blocks)
            .flat_map(|n| {
                [
                    format!("/// Step {n}."),
                    format!("pub fn step{n}(order: &Order) -> u32 {{"),
                    "    /* the total,".to_string(),
                    "       with tax */".to_string(),
                    format!("    let total = order.total() + {n};"),
                    "    if total > 100 {".to_string(),
                    "        return total - 10; // a discount".to_string(),
                    "    }".to_string(),
                    "    total".to_string(),
                    "}".to_string(),
                ]
            })
            .collect()
    }

    fn joined(lines: &[String]) -> String {
        format!("{}\n", lines.join("\n"))
    }

    #[test]
    fn a_changed_text_is_colored_again_only_around_its_change() {
        let mut lines = rust_file(100);
        let first = color_text("a.rs", joined(&lines), None, &AtomicBool::new(false)).unwrap();
        assert_eq!(first.recolored, 1000);

        type Edit = fn(&mut Vec<String>);
        let edits: [(&str, Edit, usize); 5] = [
            (
                "a line changed",
                |l| l[504] = "    let total = 7;".into(),
                2 * CHECKPOINT_LINES,
            ),
            (
                "a line added",
                |l| l.insert(30, "    let x = 1;".into()),
                2 * CHECKPOINT_LINES,
            ),
            (
                "lines removed",
                |l| drop(l.drain(700..705)),
                2 * CHECKPOINT_LINES,
            ),
            (
                "lines added at the end",
                |l| l.push("// the end".into()),
                2 * CHECKPOINT_LINES,
            ),
            ("a comment opened", |l| l[300] = "/* open".into(), 1000),
        ];
        let mut before = first;
        for (name, edit, most) in edits {
            edit(&mut lines);
            let text = joined(&lines);
            let again = colored_after("a.rs", &text, &before);
            assert_eq!(
                *again.lines,
                colored("a.rs", &text),
                "{name}: as colored whole"
            );
            assert!(
                again.recolored <= most,
                "{name}: {} lines colored",
                again.recolored
            );
            before = again;
        }
    }

    #[test]
    fn another_grammar_colors_the_text_whole() {
        let text = joined(&rust_file(20));
        let before = color_text("a.rs", text.clone(), None, &AtomicBool::new(false)).unwrap();
        let again = colored_after("a.js", &text, &before);
        assert_eq!(again.recolored, 200);
        assert_eq!(*again.lines, colored("a.js", &text));
    }

    #[test]
    fn line_checks_match_the_frontend() {
        // the same values as `lineCheck` in the frontend's tests
        assert_eq!(line_check(""), 0x811c_9dc5);
        assert_eq!(line_check("fn main() {}"), 0x9f73_1f0f);
        assert_eq!(line_check("é→😀"), 0x7ab3_ca77);
    }
}
