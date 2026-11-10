//! How a file of a folder is read, for the Files panel and for a diff alike: at a plain relative
//! path only, within these limits, cut at its last whole line, binary by git's heuristic.

use std::path::{Component, Path};

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
