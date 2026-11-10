//! One version of a file, whole, for what needs more than a diff's lines: the text of both sides
//! of a diff for their syntax colors, the bytes of both sides of an image's.

use std::path::Path;

use super::commits::checked_commit;
use super::contracts::FileVersion;
use crate::modules::folder::{
    checked_path, existing_root, looks_binary, RepositoryBackend, RepositoryInfo, WorktreeEntry,
    MAX_IMAGE_BYTES,
};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// A version of a file, as `load_version_text` finds it.
#[derive(Debug, PartialEq, Eq)]
pub enum VersionText {
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
pub fn load_version_text(
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

/// What git takes for an object of a diff's side: a whole id, SHA-1 or SHA-256, as status and
/// diff-tree print it. Anything else is refused before git runs.
fn checked_blob(id: &str) -> anyhow::Result<&str> {
    let whole = matches!(id.len(), 40 | 64) && id.bytes().all(|b| b.is_ascii_hexdigit());
    if whole {
        Ok(id)
    } else {
        anyhow::bail!("not an object id")
    }
}

/// The size of object `blob`, for the viewer to tell an image's before it loads.
pub fn load_blob_size(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    blob: &str,
) -> anyhow::Result<u64> {
    let root = existing_root(backend, repository)?;
    // a size in decimal: 20 digits at most
    let out = backend.git(root, &["cat-file", "-s", checked_blob(blob)?], 64)?;
    if out.code != 0 {
        return Err(user_facing(UserFacingErrorCode::FileMissing));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().parse()?)
}

/// The bytes of object `blob`, a side of an image's diff: at most `MAX_IMAGE_BYTES`. An object
/// never changes, so neither does what its URL loads.
pub fn load_blob_image(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    blob: &str,
) -> anyhow::Result<Vec<u8>> {
    let root = existing_root(backend, repository)?;
    let out = backend.git(
        root,
        &["cat-file", "blob", checked_blob(blob)?],
        MAX_IMAGE_BYTES,
    )?;
    if out.truncated {
        anyhow::bail!("larger than {MAX_IMAGE_BYTES} bytes");
    }
    if out.code != 0 {
        return Err(user_facing(UserFacingErrorCode::FileMissing));
    }
    Ok(out.stdout)
}
