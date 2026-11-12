//! How a file of a folder is read, for the Files panel and for a diff alike: at a plain relative
//! path only, within these limits, cut at its last whole line, binary by git's heuristic; and the
//! file the Files panel or the viewer opens.

use std::path::{Component, Path};

use super::contracts::{FileContent, FileStamp, RepositoryInfo};
use super::open::existing_root;
use super::ports::{RepositoryBackend, WorktreeEntry};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// The Files panel shows at most this many files of a project's folder: past them (an unignored
/// `node_modules` of hundreds of thousands), the tree stops there.
pub const MAX_TREE_PATHS: usize = 200_000;

/// The Files panel shows a file's first 2 MiB, cut at the last whole line; a diff is cut there too.
pub const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;

/// Larger images are not shown, in the viewer or a Markdown preview (the frontend's
/// `MAX_IMAGE_BYTES` says the same).
pub const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

/// Only a plain relative path may reach git or the disk: no `..`, no absolute path, nothing that
/// names a file outside the folder.
pub fn checked_path(path: &str) -> anyhow::Result<&str> {
    let normal = !path.is_empty()
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if normal {
        Ok(path)
    } else {
        Err(user_facing(UserFacingErrorCode::PathOutsideRepository))
    }
}

/// Output cut anywhere, back to its last whole line, if it has one.
pub fn cut_at_line(mut bytes: Vec<u8>) -> Vec<u8> {
    if let Some(end) = bytes.iter().rposition(|&b| b == b'\n') {
        bytes.truncate(end + 1);
    }
    bytes
}

/// A NUL in the first 8 KiB: the heuristic git uses to call a file binary.
pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(8000)].contains(&0)
}

/// One file of a repository as the Files panel shows it: its text, or what it is instead. A link
/// is never followed, so nothing outside the repository is read through one.
pub fn load_file_content(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    path: &str,
) -> anyhow::Result<FileContent> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(path)?;
    let entry = backend
        .read_entry(root, Path::new(path), MAX_FILE_BYTES)
        .ok_or_else(|| user_facing(UserFacingErrorCode::FileMissing))?;
    Ok(match entry {
        WorktreeEntry::File { head, truncated } => file_content(head, truncated),
        WorktreeEntry::Link(target) => FileContent::Link { target },
        WorktreeEntry::Folder => FileContent::Folder,
    })
}

/// The first bytes of a file as the Files panel shows them: binary, or text, cut at its last whole
/// line when the file goes on.
fn file_content(head: Vec<u8>, truncated: bool) -> FileContent {
    if looks_binary(&head) {
        return FileContent::Binary;
    }
    let head = if truncated { cut_at_line(head) } else { head };
    FileContent::Text {
        text: String::from_utf8_lossy(&head).into_owned(),
        truncated,
    }
}

/// A file's size and last change; links never followed.
pub fn load_file_stamp(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    path: &str,
) -> anyhow::Result<FileStamp> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(path)?;
    backend
        .file_stamp(root, Path::new(path))
        .ok_or_else(|| user_facing(UserFacingErrorCode::FileMissing))
}

/// A file's bytes whole, for the viewer to show as an image: at most `MAX_IMAGE_BYTES`, a link
/// never followed.
pub fn load_image(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    path: &str,
) -> anyhow::Result<Vec<u8>> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(path)?;
    match backend.read_entry(root, Path::new(path), MAX_IMAGE_BYTES) {
        Some(WorktreeEntry::File {
            head,
            truncated: false,
        }) => Ok(head),
        Some(WorktreeEntry::File { .. }) => anyhow::bail!("larger than {MAX_IMAGE_BYTES} bytes"),
        Some(WorktreeEntry::Link(_) | WorktreeEntry::Folder) | None => {
            Err(user_facing(UserFacingErrorCode::FileMissing))
        }
    }
}
