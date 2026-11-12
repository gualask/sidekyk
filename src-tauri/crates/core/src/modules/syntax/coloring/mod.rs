//! A text's colors from bat's grammars (two-face, through syntect): the grammar is picked by the
//! file's name, its extension, then its first line (`#!/usr/bin/env bash`). Lines are read one
//! after the other, each from the state the one above left, as a TextMate grammar is (`line`); a
//! changed text again from the state kept before its change (`incremental`); the tones as a theme
//! (`tones`).

mod incremental;
mod line;
mod tones;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use syntect::highlighting::Highlighter;
use syntect::parsing::{SyntaxReference, SyntaxSet};
use syntect::util::LinesWithEndings;

use super::cache::{Coloring, Lines};
use incremental::{Pass, State, Unchanged};
use line::{line_colors, uncolored};
use tones::THEME;

/// Coloring stops after this long, the lines left keeping the text's color: some grammars crawl on
/// some texts. An 885 KiB Rust file takes 0.64 s.
const MAX_COLORING_TIME: Duration = Duration::from_secs(2);

/// Loaded once, the first time a file is colored (~2 ms, ~4 MB).
static SYNTAXES: LazyLock<SyntaxSet> = LazyLock::new(two_face::syntax::extra_newlines);

/// FNV-1a over the line's UTF-16 units: the frontend hashes its own text the same way.
pub fn line_check(line: &str) -> u32 {
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

/// A text colored: each line's colors, and what coloring it again after a change starts from.
pub struct Colored {
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
        None => Pass::default(),
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
    let (mut pass, mut state) = match &unchanged {
        Some(unchanged) => unchanged.restart(),
        None => (Pass::default(), State::new(grammar, &highlighter)),
    };

    let restarted = pass.lines.len();
    let mut rest = all.iter().enumerate().skip(restarted);
    for (index, &line) in rest.by_ref() {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        if started.elapsed() > time {
            tracing::debug!(path, line = index + 1, "coloring stopped, too long");
            pass.lines.push(uncolored(line));
            break;
        }
        pass.keep_state(index, &state);
        let converged = unchanged
            .as_ref()
            .and_then(|unchanged| unchanged.converged(index, all.len(), &state));
        if let Some(old) = converged {
            pass.join(index, old);
            pass.recolored = index - restarted;
            return Some(pass);
        }
        let Some(colors) = line_colors(line, &mut state, &highlighter) else {
            pass.lines.push(uncolored(line));
            break;
        };
        pass.lines.push(colors);
    }
    // stopped: the lines left keep the text's color
    for (_, &line) in rest {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        pass.lines.push(uncolored(line));
    }
    pass.recolored = all.len() - restarted;
    Some(pass)
}

#[cfg(test)]
mod tests {
    use super::super::contracts::{LineColors, Tone};
    use super::incremental::CHECKPOINT_LINES;
    use super::line::MAX_COLORED_LINE_BYTES;
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
    fn fenced_code_in_markdown_takes_its_language_tones() {
        let text = "Some `inline`.\n\n```rust\nlet total = count + 1;\n```\n";
        let lines = colored("README.md", text);
        let fence = "let total = count + 1;";
        let parts = toned(fence, &lines[3]);
        assert!(
            parts.contains(&("let".to_string(), Tone::Keyword)),
            "{parts:?}"
        );
        // the plain words of the code keep the text's color, as in the language's own file
        assert!(
            parts.iter().all(|(part, _)| !part.contains("total")),
            "{parts:?}"
        );
        assert!(
            toned("Some `inline`.", &lines[0]).contains(&("`inline`".to_string(), Tone::String))
        );
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
