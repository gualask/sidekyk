//! How much of the working tree's changes is formatting only, read when the user asks: never
//! with a snapshot, since it diffs every changed file once more (`docs/features/changes.md`).

use super::contracts::{AreaLines, ChangeArea, ChangesIgnoringWhitespace, RepositoryInfo};
use super::open::existing_root;
use super::ports::{joined, RepositoryBackend};
use super::snapshot::{numstat, Numstat};

/// Makes git ignore every whitespace difference, line endings included (`\r` is whitespace to
/// git).
const IGNORE_WHITESPACE: &str = "--ignore-all-space";

fn area_lines(area: ChangeArea, read: Numstat, files: &mut Vec<AreaLines>) {
    for (path, counts) in read.counts {
        if let (Some(additions), Some(deletions)) = (counts.additions, counts.deletions) {
            files.push(AreaLines {
                path,
                area,
                additions,
                deletions,
            });
        }
    }
}

/// The staged and unstaged changes as `git diff -w` counts them, both read together.
pub fn load_changes_ignoring_whitespace(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<ChangesIgnoringWhitespace> {
    let root = existing_root(backend, repository)?;
    let (unstaged, staged) = std::thread::scope(|scope| {
        let staged = scope.spawn(|| numstat(backend, root, &["--cached", IGNORE_WHITESPACE]));
        (numstat(backend, root, &[IGNORE_WHITESPACE]), joined(staged))
    });
    let (unstaged, staged) = (unstaged?, staged?);
    let truncated = unstaged.truncated || staged.truncated;
    let mut files = Vec::new();
    area_lines(ChangeArea::Unstaged, unstaged, &mut files);
    area_lines(ChangeArea::Staged, staged, &mut files);
    // in git's order, not the map's: the same answer every time, here or from a helper
    files.sort_unstable_by(|a, b| a.path.cmp(&b.path).then(a.area.cmp(&b.area)));
    Ok(ChangesIgnoringWhitespace { files, truncated })
}
