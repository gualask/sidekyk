//! The disk `LocalRepositoryBackend` reads directly, within limits: a file, and under a root what
//! is at a path, never through a folder that is a link, so a link cannot lead out of the
//! repository.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::modules::folder::{FileStamp, WorktreeEntry};
use crate::shared::threads::threads;

/// Fewer last changes than this are read on the caller's thread: a thread costs more than them.
const MIN_TIMES_PER_THREAD: usize = 1_024;

/// `RepositoryBackend::read_file`.
pub(super) fn read_file(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > limit {
        return None;
    }
    std::fs::read(path).ok()
}

/// `RepositoryBackend::read_entry`.
pub(super) fn read_entry(root: &Path, path: &Path, limit: usize) -> Option<WorktreeEntry> {
    let (full, meta) = inside(root, path)?;
    if meta.is_symlink() {
        return std::fs::read_link(&full)
            .ok()
            .map(|target| WorktreeEntry::Link(link_target(&target)));
    }
    if meta.is_dir() {
        return Some(WorktreeEntry::Folder);
    }
    let mut head = Vec::new();
    let read = std::fs::File::open(&full)
        .ok()?
        .take(limit as u64 + 1)
        .read_to_end(&mut head)
        .ok()?;
    let truncated = read > limit;
    head.truncate(limit);
    Some(WorktreeEntry::File { head, truncated })
}

/// `RepositoryBackend::file_stamp`.
pub(super) fn file_stamp(root: &Path, path: &Path) -> Option<FileStamp> {
    let (_, meta) = inside(root, path)?;
    if !meta.is_file() {
        return None;
    }
    Some(FileStamp {
        size: meta.len(),
        modified: modified_millis(&meta)?,
    })
}

/// `RepositoryBackend::modified_times`: read in parts on several threads when they are many.
pub(super) fn modified_times(root: &Path, paths: &[&str]) -> Vec<Option<i64>> {
    // the tree's order keeps a folder's files together, so each part checks few folders
    let part = paths.len().div_ceil(threads()).max(MIN_TIMES_PER_THREAD);
    if paths.len() <= part {
        return modified_times_in(root, paths);
    }
    std::thread::scope(|scope| {
        let parts: Vec<_> = paths
            .chunks(part)
            .map(|chunk| {
                (
                    chunk.len(),
                    scope.spawn(move || modified_times_in(root, chunk)),
                )
            })
            .collect();
        parts
            .into_iter()
            .flat_map(|(len, handle)| handle.join().unwrap_or_else(|_| vec![None; len]))
            .collect()
    })
}

/// The last changes of `paths` under `root`, on this thread; `None` behind a folder that is a
/// link.
fn modified_times_in(root: &Path, paths: &[&str]) -> Vec<Option<i64>> {
    let mut folders = RealFolders::new(root);
    paths
        .iter()
        .map(|path| {
            folders
                .holds(path)
                .then(|| modified_at(root, path))
                .flatten()
        })
        .collect()
}

/// `RepositoryBackend::open_file`.
pub(super) fn open_file(root: &Path, path: &Path) -> Option<Box<dyn Read + Send>> {
    let (full, meta) = inside(root, path)?;
    if !meta.is_file() {
        return None;
    }
    let file = std::fs::File::open(full).ok()?;
    Some(Box::new(file))
}

/// `RepositoryBackend::folders`.
pub(super) fn folders(root: &Path, path: &Path) -> Option<Vec<PathBuf>> {
    let folder = if path.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        let (full, meta) = inside(root, path)?;
        meta.is_dir().then_some(full)?
    };
    let entries = std::fs::read_dir(folder).ok()?;
    Some(
        entries
            .filter_map(Result::ok)
            // the entry's own type: a link to a folder is not one
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| PathBuf::from(entry.file_name()))
            .collect(),
    )
}

/// A link's target as git stores it, with `/` between names: Windows writes `\`.
fn link_target(target: &Path) -> String {
    let text = target.to_string_lossy();
    if cfg!(windows) {
        text.replace('\\', "/")
    } else {
        text.into_owned()
    }
}

/// `path` (relative) under `root` and what is there, not following a link, or `None` when nothing
/// is there or a folder on the way is not a real one, so a link cannot lead out of the repository.
fn inside(root: &Path, path: &Path) -> Option<(PathBuf, std::fs::Metadata)> {
    let mut folder = root.to_path_buf();
    for name in path.parent()?.components() {
        folder.push(name);
        if !is_real_folder(&folder) {
            return None;
        }
    }
    let full = root.join(path);
    let meta = std::fs::symlink_metadata(&full).ok()?;
    Some((full, meta))
}

/// Whether a folder is at `path`, itself and not a link to one.
fn is_real_folder(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir())
}

/// A file's last change, in milliseconds since the Unix epoch; `None` before it.
fn modified_millis(meta: &std::fs::Metadata) -> Option<i64> {
    let since = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some(i64::try_from(since.as_millis()).unwrap_or(i64::MAX))
}

/// The last change of what is at `path` under `root`, a link's own; `None` for a folder.
fn modified_at(root: &Path, path: &str) -> Option<i64> {
    let meta = std::fs::symlink_metadata(root.join(path)).ok()?;
    if meta.is_dir() {
        return None;
    }
    modified_millis(&meta)
}

/// The folders on the way to files under `root`, each checked once: a real folder, not a link,
/// as `inside` checks them for one file.
struct RealFolders<'a> {
    root: &'a Path,
    known: HashMap<&'a str, bool>,
}

impl<'a> RealFolders<'a> {
    fn new(root: &'a Path) -> Self {
        Self {
            root,
            known: HashMap::new(),
        }
    }

    /// Whether every folder above `path` (`/` between names) is a real one.
    fn holds(&mut self, path: &'a str) -> bool {
        let (root, known) = (self.root, &mut self.known);
        path.match_indices('/').all(|(end, _)| {
            let folder = &path[..end];
            *known
                .entry(folder)
                .or_insert_with(|| is_real_folder(&root.join(folder)))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn modified_times_come_from_the_disk_never_through_a_linked_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let at = |path: &str, secs: u64| {
            write(root, path, "x");
            let time = std::time::UNIX_EPOCH + Duration::from_secs(secs);
            std::fs::File::options()
                .write(true)
                .open(root.join(path))
                .unwrap()
                .set_modified(time)
                .unwrap();
        };
        at("a.md", 1_000);
        at("docs/b.md", 2_000);
        std::fs::create_dir(root.join("empty")).unwrap();
        assert_eq!(
            modified_times(root, &["a.md", "docs/b.md", "docs", "gone.md", "empty/x"]),
            [Some(1_000_000), Some(2_000_000), None, None, None]
        );

        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            write(outside.path(), "secret.md", "s");
            std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
            std::os::unix::fs::symlink("a.md", root.join("alias.md")).unwrap();
            let times = modified_times(root, &["linked/secret.md", "alias.md"]);
            assert_eq!(times[0], None, "behind a linked folder");
            assert!(times[1].is_some(), "a link's own time");
        }

        // enough files for several threads, each part in the callers' order
        let many: Vec<String> = (0..3 * MIN_TIMES_PER_THREAD)
            .map(|i| format!("many/{}/{i}", i % 7))
            .collect();
        for (i, path) in many.iter().enumerate() {
            at(path, 10_000 + i as u64);
        }
        let paths: Vec<&str> = many.iter().map(String::as_str).collect();
        let times = modified_times(root, &paths);
        let expected: Vec<Option<i64>> = (0..many.len())
            .map(|i| Some((10_000 + i as i64) * 1_000))
            .collect();
        assert_eq!(times, expected);
    }
}
