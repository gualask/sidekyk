//! The text of one version of a file, whole, for what needs more than a diff's lines: the syntax
//! colors of both sides of a diff.

use std::path::Path;

use super::commits::checked_commit;
use super::contracts::{FileVersion, RepositoryInfo};
use super::diff::checked_path;
use super::numstat::looks_binary;
use super::open::existing_root;
use super::ports::{RepositoryBackend, WorktreeEntry};

/// A version of a file, as `load_version_text` finds it.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum VersionText {
    Text(Vec<u8>),
    /// Larger than the limit asked for: not read past it.
    TooLarge,
    Binary,
    /// Not in that version, or no file there: a link (never followed), a submodule.
    Missing,
}

/// Bytes read as they are, or what they are instead when they cannot be text.
fn text_or_binary(bytes: Vec<u8>) -> VersionText {
    if looks_binary(&bytes) {
        VersionText::Binary
    } else {
        VersionText::Text(bytes)
    }
}

/// The text of `path` in `version`, if no larger than `limit` bytes. A working-tree link is never
/// followed; a git version is the blob as stored (`git cat-file`), as a diff compares it.
pub(crate) fn load_version_text(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    path: &str,
    version: &FileVersion,
    limit: usize,
) -> anyhow::Result<VersionText> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(path)?;
    let object = match version {
        FileVersion::Worktree => {
            return Ok(match backend.read_entry(root, Path::new(path), limit) {
                Some(WorktreeEntry::File {
                    truncated: true, ..
                }) => VersionText::TooLarge,
                Some(WorktreeEntry::File { head, .. }) => text_or_binary(head),
                Some(WorktreeEntry::Link(_) | WorktreeEntry::Folder) | None => VersionText::Missing,
            });
        }
        FileVersion::Index => format!(":{path}"),
        FileVersion::Head => format!("HEAD:{path}"),
        FileVersion::Commit { sha } => format!("{}:{path}", checked_commit(sha)?),
    };
    // a path not in that version (or no HEAD yet) fails: nothing to read
    let out = backend.git(root, &["cat-file", "blob", &object], limit)?;
    Ok(if out.truncated {
        VersionText::TooLarge
    } else if out.code != 0 {
        VersionText::Missing
    } else {
        text_or_binary(out.stdout)
    })
}
