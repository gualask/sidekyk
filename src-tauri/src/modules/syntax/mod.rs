//! Syntax colors for the viewer: a version of a file colored with bat's grammars, kept while it
//! does not change, and served a block of lines at a time, the blocks on screen. A changed version
//! is colored again only around its changes. Read-only, as the repository module it reads
//! through.

mod cache;
mod colors;
mod contracts;

use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use cache::{Coloring, Lines};
#[cfg(test)]
pub(crate) use colors::line_check;
pub(crate) use contracts::{SyntaxColors, SyntaxRequest};

use crate::modules::repository::{
    load_version_text, FileVersion, RepositoryBackend, RepositoryInfo, VersionText,
};

/// The colors of the last versions colored, and the thread that colors them, in the app's state.
pub(crate) type ColorCache = cache::ColorThread<colors::Colored>;

impl Default for ColorCache {
    fn default() -> Self {
        Self::new(color_logged)
    }
}

/// Colors a file's text, from the coloring of the text before it, and logs how long it took. Bytes
/// that are not UTF-8 are read as the diff reads them, lossily.
fn color_logged(
    path: &str,
    bytes: Vec<u8>,
    before: Option<&colors::Colored>,
    cancelled: &AtomicBool,
) -> Option<colors::Colored> {
    let started = Instant::now();
    let text = String::from_utf8(bytes)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned());
    let colored = colors::color_text(path, text, before, cancelled)?;
    let ms = started.elapsed().as_millis() as u64;
    let (lines, recolored) = (colored.lines().len(), colored.recolored);
    tracing::debug!(path, ms, lines, recolored, "colored");
    Some(colored)
}

/// Larger files are shown without colors: past this, a grammar takes seconds on some languages
/// (20,000 lines of a log, ~2.8 s).
const MAX_COLORED_BYTES: usize = 1024 * 1024;

/// The most lines one request may ask for: a few screens.
const MAX_LINES_ASKED: u32 = 2048;

/// Reads of a file that changed while being colored, before answering with its last colors.
const ATTEMPTS: usize = 3;

/// The colors of the lines asked for of a version of a file, colored on the coloring thread: whole
/// the first time, then from the colors of the text before. A newer text of the file stops the run
/// of an older one, whose callers read it again; a file that keeps changing meanwhile gets its last
/// colors, which the viewer takes only for the lines whose text they were of.
pub(crate) fn load_syntax_colors(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    cache: &ColorCache,
    request: &SyntaxRequest,
) -> anyhow::Result<SyntaxColors> {
    anyhow::ensure!(
        request.first >= 1 && request.count <= MAX_LINES_ASKED,
        "lines {} +{} cannot be asked for",
        request.first,
        request.count
    );
    let version = match &request.version {
        FileVersion::Worktree => "worktree",
        FileVersion::Index => "index",
        FileVersion::Head => "head",
        FileVersion::Commit { sha } => sha,
    };
    let key = format!("{}\0{}\0{version}", repository.root, request.path);
    for _ in 0..ATTEMPTS {
        let bytes = match load_version_text(
            backend,
            repository,
            &request.path,
            &request.version,
            MAX_COLORED_BYTES,
        )? {
            VersionText::Text(bytes) => bytes,
            VersionText::TooLarge => {
                return Ok(SyntaxColors {
                    too_large: true,
                    lines: Vec::new(),
                })
            }
            VersionText::Binary | VersionText::Missing => return Ok(SyntaxColors::default()),
        };
        let mut hasher = DefaultHasher::new();
        bytes.hash(&mut hasher);
        if let Some(lines) = cache.colored(&key, hasher.finish(), &request.path, bytes) {
            return Ok(block(&lines, request));
        }
    }
    Ok(cache
        .latest(&key)
        .map(|lines| block(&lines, request))
        .unwrap_or_default())
}

/// The lines asked for, fewer past the end.
fn block(lines: &Lines, request: &SyntaxRequest) -> SyntaxColors {
    let first = request.first as usize - 1;
    SyntaxColors {
        too_large: false,
        lines: lines
            .iter()
            .skip(first)
            .take(request.count as usize)
            .cloned()
            .collect(),
    }
}
