//! Search in contents (`⌘F`): the lines of a project's files where a text is. Files are read
//! through the `RepositoryBackend` port, never followed through a link, on threads that take the
//! next file as they finish one; each reads through a fixed buffer, skips a binary at its first
//! NUL and stops past what the viewer shows. Not tied to git: any list of files will do.

use std::io::Read;
use std::ops::Range;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};

use super::contracts::{ContentFile, ContentLine, Highlight};
use crate::modules::repository::{RepositoryBackend, MAX_FILE_BYTES};
use crate::shared::sync::lock;
use crate::shared::threads::threads;

/// Shorter texts match nearly every line of a project (the palette's `MIN_CONTENT_QUERY`).
const MIN_QUERY_CHARS: usize = 2;

/// Lines sent at most: a common text stops the search there instead of reading every file.
const MAX_LINES: usize = 2_000;

/// A line's text sent at most, in characters, around its first match.
const MAX_LINE_CHARS: usize = 300;

/// Characters kept before a long line's first match.
const CHARS_BEFORE: usize = 40;

/// Files found are sent in batches at most this often, so a search with many does not flood the
/// window with messages.
const SEND_EVERY: Duration = Duration::from_millis(50);

/// What to search, and in which files (paths relative to `root`, with `/`).
pub struct ContentSearch<'a> {
    pub backend: &'a dyn RepositoryBackend,
    pub root: &'a Path,
    pub files: &'a [&'a str],
    pub query: &'a str,
}

/// How a search went: the files where the text is, and whether it read them all.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Searched {
    pub files: Vec<String>,
    /// Stopped at `MAX_LINES`: more lines matched than were sent.
    pub cut: bool,
}

/// The text as typed, literally; case is ignored unless it has a capital letter (smart case, as
/// ripgrep and Zed). None for a text too short to search.
fn matcher(query: &str) -> Option<RegexMatcher> {
    if query.chars().count() < MIN_QUERY_CHARS {
        return None;
    }
    RegexMatcherBuilder::new()
        .fixed_strings(true)
        .case_smart(true)
        .build(query)
        .ok()
}

/// Searches the files for the text, sending what it finds to `send` as it goes, until
/// `cancelled` says a newer search took over.
pub fn search_contents(
    search: &ContentSearch,
    cancelled: &(dyn Fn() -> bool + Sync),
    send: &(dyn Fn(Vec<ContentFile>) + Sync),
) -> Searched {
    let Some(matcher) = matcher(search.query) else {
        return Searched::default();
    };
    let next = AtomicUsize::new(0);
    let lines = AtomicUsize::new(0);
    let cut = AtomicBool::new(false);
    let found = Mutex::new(Found {
        unsent: Vec::new(),
        sent_at: Instant::now(),
        files: Vec::new(),
    });

    std::thread::scope(|scope| {
        for _ in 0..threads().min(search.files.len()) {
            scope.spawn(|| {
                let mut searcher = SearcherBuilder::new()
                    .binary_detection(BinaryDetection::quit(0))
                    .line_number(true)
                    .build();
                while !cut.load(Ordering::Relaxed) && !cancelled() {
                    let Some(path) = search.files.get(next.fetch_add(1, Ordering::Relaxed)) else {
                        break;
                    };
                    let Some(file) = search.backend.open_file(search.root, Path::new(path)) else {
                        continue;
                    };
                    let mut sink = FileSink {
                        matcher: &matcher,
                        lines: Vec::new(),
                        total: &lines,
                        cut: &cut,
                        cancelled,
                    };
                    // past what the viewer shows, a match could not be opened
                    let head = file.take(MAX_FILE_BYTES as u64);
                    // an unreadable file is left out, as a binary one is
                    let _ = searcher.search_reader(&matcher, head, &mut sink);
                    if sink.lines.is_empty() {
                        continue;
                    }
                    // sent out of the lock, so the other threads do not wait on the window
                    let ready = lock(&found).add(path, sink.lines);
                    if let Some(files) = ready {
                        send(files);
                    }
                }
            });
        }
    });

    let mut found = found
        .into_inner()
        .unwrap_or_else(|poison| poison.into_inner());
    if !found.unsent.is_empty() {
        send(std::mem::take(&mut found.unsent));
    }
    Searched {
        files: found.files,
        cut: cut.into_inner(),
    }
}

/// What the threads found, and what of it is not sent yet.
struct Found {
    unsent: Vec<ContentFile>,
    sent_at: Instant,
    files: Vec<String>,
}

impl Found {
    /// Adds a file's lines; the files not sent yet once it is time to send them.
    fn add(&mut self, path: &str, lines: Vec<ContentLine>) -> Option<Vec<ContentFile>> {
        self.files.push(path.to_string());
        self.unsent.push(ContentFile {
            path: path.to_string(),
            lines,
        });
        if self.sent_at.elapsed() < SEND_EVERY {
            return None;
        }
        self.sent_at = Instant::now();
        Some(std::mem::take(&mut self.unsent))
    }
}

/// One file's matching lines, until the search has as many as it sends.
struct FileSink<'a> {
    matcher: &'a RegexMatcher,
    lines: Vec<ContentLine>,
    total: &'a AtomicUsize,
    cut: &'a AtomicBool,
    cancelled: &'a (dyn Fn() -> bool + Sync),
}

impl Sink for FileSink<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _: &Searcher, found: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if (self.cancelled)() {
            return Ok(false);
        }
        if self.total.fetch_add(1, Ordering::Relaxed) >= MAX_LINES {
            self.cut.store(true, Ordering::Relaxed);
            return Ok(false);
        }
        let number = found.line_number().unwrap_or(0);
        self.lines.push(content_line(
            self.matcher,
            u32::try_from(number).unwrap_or(u32::MAX),
            found.bytes(),
        ));
        Ok(true)
    }
}

/// A matching line as the palette lists it: without its end of line and its indentation, cut
/// around its first match when long, with where the text is in it.
fn content_line(matcher: &RegexMatcher, number: u32, bytes: &[u8]) -> ContentLine {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    let Ok(line) = std::str::from_utf8(bytes) else {
        // not UTF-8: shown as it can be, nothing to point at
        let text: String = String::from_utf8_lossy(bytes)
            .trim_start()
            .chars()
            .take(MAX_LINE_CHARS)
            .collect();
        return ContentLine {
            number,
            text,
            highlights: Vec::new(),
        };
    };
    let mut matches: Vec<Range<usize>> = Vec::new();
    let _ = matcher.find_iter(line.as_bytes(), |found| {
        matches.push(found.start()..found.end());
        true
    });

    let indent = line.len() - line.trim_start().len();
    let first = matches.first().map_or(indent, |found| found.start);
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

/// Whether every file where `next` is also has `previous`, so a search for `next` need read only
/// the files a complete search for `previous` found. The text grew by typing on, and both are
/// matched as `matcher` does: case ignored for one without a capital letter. Only for plain ASCII
/// `previous`, whose letters fold as simply as a comparison here does.
pub fn narrows(previous: &str, next: &str) -> bool {
    if !previous.is_ascii() || matcher(previous).is_none() {
        return false;
    }
    if previous.chars().any(|c| c.is_ascii_uppercase()) {
        next.contains(previous)
    } else {
        next.to_ascii_lowercase().contains(previous)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::repository::{FolderRules, GitOutput, Walked, WorktreeEntry};
    use std::collections::HashMap;

    /// Files by path, read from memory.
    struct FakeFiles(HashMap<&'static str, Vec<u8>>);

    impl RepositoryBackend for FakeFiles {
        fn is_dir(&self, _path: &Path) -> bool {
            unreachable!()
        }

        fn has_entry(&self, _root: &Path, _path: &Path) -> bool {
            unreachable!()
        }

        fn folders(&self, _root: &Path, _path: &Path) -> Option<Vec<std::path::PathBuf>> {
            unreachable!()
        }

        fn git(&self, _cwd: &Path, _args: &[&str], _max: usize) -> anyhow::Result<GitOutput> {
            unreachable!()
        }

        fn git_with_input(
            &self,
            _cwd: &Path,
            _args: &[&str],
            _input: &[u8],
            _max: usize,
        ) -> anyhow::Result<GitOutput> {
            unreachable!()
        }

        fn read_file(&self, _path: &Path, _limit: u64) -> Option<Vec<u8>> {
            unreachable!()
        }

        fn read_entry(&self, _root: &Path, _path: &Path, _limit: usize) -> Option<WorktreeEntry> {
            unreachable!()
        }

        fn open_file(&self, _root: &Path, path: &Path) -> Option<Box<dyn Read + Send>> {
            let bytes = self.0.get(path.to_str()?)?.clone();
            Some(Box::new(std::io::Cursor::new(bytes)))
        }

        fn file_stamp(
            &self,
            _root: &Path,
            _path: &Path,
        ) -> Option<crate::modules::repository::FileStamp> {
            unreachable!()
        }

        fn walk(&self, _root: &Path, _max: usize) -> Walked {
            unreachable!()
        }

        fn folder_rules(&self, _root: &Path) -> Box<dyn FolderRules> {
            unreachable!()
        }

        fn real_path(&self, _path: &Path) -> Option<std::path::PathBuf> {
            unreachable!()
        }
    }

    fn run(files: &[(&'static str, &str)], query: &str) -> (Vec<ContentFile>, Searched) {
        let backend = FakeFiles(
            files
                .iter()
                .map(|(path, text)| (*path, text.as_bytes().to_vec()))
                .collect(),
        );
        let paths: Vec<&str> = files.iter().map(|(path, _)| *path).collect();
        let sent = Mutex::new(Vec::new());
        let searched = search_contents(
            &ContentSearch {
                backend: &backend,
                root: Path::new("/r"),
                files: &paths,
                query,
            },
            &|| false,
            &|files| sent.lock().unwrap().extend(files),
        );
        let mut sent = sent.into_inner().unwrap();
        sent.sort_by(|a, b| a.path.cmp(&b.path));
        (sent, searched)
    }

    #[test]
    fn finds_each_line_with_its_number_and_matches() {
        let (sent, searched) = run(
            &[
                ("a.ts", "let total = 1;\n    total += total;\nother\n"),
                ("b.ts", "nothing here\n"),
            ],
            "total",
        );
        assert_eq!(
            sent,
            [ContentFile {
                path: "a.ts".into(),
                lines: vec![
                    ContentLine {
                        number: 1,
                        text: "let total = 1;".into(),
                        highlights: vec![[4, 9]],
                    },
                    ContentLine {
                        number: 2,
                        text: "total += total;".into(),
                        highlights: vec![[0, 5], [9, 14]],
                    },
                ],
            }]
        );
        assert_eq!(searched.files, ["a.ts"]);
        assert!(!searched.cut);
    }

    #[test]
    fn case_is_ignored_unless_the_text_has_a_capital() {
        let files = [("a.ts", "Total\ntotal\n")];
        assert_eq!(run(&files, "total").0[0].lines.len(), 2);
        let (sent, _) = run(&files, "Total");
        assert_eq!(sent[0].lines.len(), 1);
        assert_eq!(sent[0].lines[0].number, 1);
    }

    #[test]
    fn a_short_text_or_a_binary_file_finds_nothing() {
        assert_eq!(run(&[("a.ts", "aaa\n")], "a").1, Searched::default());
        assert!(run(&[("logo.png", "png\0total\n")], "total").0.is_empty());
    }

    #[test]
    fn a_long_line_is_cut_around_its_first_match() {
        let line = format!("{}needle{}", "x".repeat(100), "y".repeat(400));
        let (sent, _) = run(&[("a.ts", line.as_str())], "needle");
        let found = &sent[0].lines[0];
        assert!(found.text.starts_with('…') && found.text.ends_with('…'));
        assert_eq!(found.text.chars().count(), MAX_LINE_CHARS + 2);
        // "…" and the 40 characters kept before the match
        assert_eq!(found.highlights, [[41, 47]]);
    }

    #[test]
    fn highlights_count_utf16_units() {
        let (sent, _) = run(&[("a.ts", "é𝒳 needle\n")], "needle");
        assert_eq!(sent[0].lines[0].highlights, [[4, 10]]);
    }

    #[test]
    fn the_search_stops_past_its_line_limit() {
        let text = "hit\n".repeat(MAX_LINES + 10);
        let (sent, searched) = run(&[("a.ts", &text)], "hit");
        assert_eq!(sent[0].lines.len(), MAX_LINES);
        assert!(searched.cut);
    }

    #[test]
    fn a_longer_text_narrows_to_the_files_already_found() {
        assert!(narrows("fn", "fn new"));
        assert!(narrows("total", "Total"));
        assert!(narrows("Total", "Totals"));
        assert!(!narrows("Total", "total"));
        assert!(!narrows("new", "fn"));
        assert!(!narrows("é", "éa"));
        assert!(!narrows("a", "ab"));
    }
}
