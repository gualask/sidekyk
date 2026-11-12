//! Search in contents (`⌘F`): the lines of a project's files where a text is. Files are read
//! through the `RepositoryBackend` port, never followed through a link, on threads that take the
//! next file as they finish one; each reads through a fixed buffer, skips a binary at its first
//! NUL and stops past what the viewer shows. Not tied to git: any list of files will do.

use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};

use super::content_line::content_line;
use super::contracts::{ContentFile, ContentLine};
use crate::modules::folder::{RepositoryBackend, MAX_FILE_BYTES};
use crate::shared::sync::lock;
use crate::shared::threads::threads;

/// Shorter texts match nearly every line of a project (the palette's `MIN_CONTENT_QUERY`).
const MIN_QUERY_CHARS: usize = 2;

/// Lines sent at most: a common text stops the search there instead of reading every file.
const MAX_LINES: usize = 2_000;

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
/// ripgrep). None for a text too short to search.
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
    let shared = Shared::new();
    std::thread::scope(|scope| {
        for _ in 0..threads().min(search.files.len()) {
            scope.spawn(|| search_files(search, &matcher, &shared, cancelled, send));
        }
    });
    shared.finish(send)
}

/// What the threads of a search share.
struct Shared {
    /// The index of the next file to take.
    next: AtomicUsize,
    /// The lines found so far, up to `MAX_LINES`.
    lines: AtomicUsize,
    /// Past `MAX_LINES`: every thread stops.
    cut: AtomicBool,
    found: Mutex<Found>,
}

impl Shared {
    fn new() -> Self {
        Self {
            next: AtomicUsize::new(0),
            lines: AtomicUsize::new(0),
            cut: AtomicBool::new(false),
            found: Mutex::new(Found {
                unsent: Vec::new(),
                sent_at: Instant::now(),
                files: Vec::new(),
            }),
        }
    }

    /// How the search went, once its threads ended: what they found and did not send yet is
    /// sent now.
    fn finish(self, send: &(dyn Fn(Vec<ContentFile>) + Sync)) -> Searched {
        let mut found = self
            .found
            .into_inner()
            .unwrap_or_else(|poison| poison.into_inner());
        if !found.unsent.is_empty() {
            send(std::mem::take(&mut found.unsent));
        }
        Searched {
            files: found.files,
            cut: self.cut.into_inner(),
        }
    }
}

/// One thread of a search: takes the next file until none is left, the search is cut or a newer
/// one took over.
fn search_files(
    search: &ContentSearch,
    matcher: &RegexMatcher,
    shared: &Shared,
    cancelled: &(dyn Fn() -> bool + Sync),
    send: &(dyn Fn(Vec<ContentFile>) + Sync),
) {
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .build();
    while !shared.cut.load(Ordering::Relaxed) && !cancelled() {
        let Some(path) = search
            .files
            .get(shared.next.fetch_add(1, Ordering::Relaxed))
        else {
            break;
        };
        let Some(file) = search.backend.open_file(search.root, Path::new(path)) else {
            continue;
        };
        let lines = file_lines(&mut searcher, matcher, shared, cancelled, file);
        if lines.is_empty() {
            continue;
        }
        // sent out of the lock, so the other threads do not wait on the window
        let ready = lock(&shared.found).add(path, lines);
        if let Some(files) = ready {
            send(files);
        }
    }
}

/// The lines of a file where the text is, as many as the search still sends.
fn file_lines(
    searcher: &mut Searcher,
    matcher: &RegexMatcher,
    shared: &Shared,
    cancelled: &(dyn Fn() -> bool + Sync),
    file: Box<dyn Read + Send>,
) -> Vec<ContentLine> {
    let mut sink = FileSink {
        matcher,
        lines: Vec::new(),
        total: &shared.lines,
        cut: &shared.cut,
        cancelled,
    };
    // past what the viewer shows, a match could not be opened
    let head = file.take(MAX_FILE_BYTES as u64);
    // an unreadable file is left out, as a binary one is
    let _ = searcher.search_reader(matcher, head, &mut sink);
    sink.lines
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
    use crate::modules::folder::FakeBackend;
    use std::collections::HashMap;

    /// Files by path, read from memory.
    struct FakeFiles(HashMap<&'static str, Vec<u8>>);

    impl FakeBackend for FakeFiles {
        fn open_file(&self, _root: &Path, path: &Path) -> Option<Box<dyn Read + Send>> {
            let bytes = self.0.get(path.to_str()?)?.clone();
            Some(Box::new(std::io::Cursor::new(bytes)))
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
