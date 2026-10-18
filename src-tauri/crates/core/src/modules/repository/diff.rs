use std::path::{Component, Path};

use super::contracts::{ChangeArea, FileDiffRequest, RepositoryInfo, UnifiedDiff};
use super::limits::MAX_DIFF_BYTES;
use super::open::existing_root;
use super::ports::{git_checked, RepositoryBackend};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// Only a plain relative path may reach git: no `..`, no absolute path, nothing that names a
/// file outside the repository.
pub(super) fn checked_path(path: &str) -> anyhow::Result<&str> {
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

/// The lines of context around each change: three, as git's default, or every line of the file
/// (git's largest), so the diff is the whole file with its changes.
pub(super) fn context_option(whole_file: bool) -> &'static str {
    if whole_file {
        "-U2147483647"
    } else {
        "-U3"
    }
}

/// Output cut anywhere, back to its last whole line, if it has one.
pub(super) fn cut_at_line(mut bytes: Vec<u8>) -> Vec<u8> {
    if let Some(end) = bytes.iter().rposition(|&b| b == b'\n') {
        bytes.truncate(end + 1);
    }
    bytes
}

pub fn load_file_diff(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    request: &FileDiffRequest,
) -> anyhow::Result<UnifiedDiff> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(&request.path)?;
    let orig_path = request.orig_path.as_deref().map(checked_path).transpose()?;
    let base = [
        "--no-color",
        "--no-ext-diff",
        context_option(request.whole_file),
    ];

    let mut args = vec!["diff"];
    let mut ok_codes = vec![0];
    match request.area {
        ChangeArea::Unstaged => {
            args.extend(base);
            args.extend(["--", path]);
        }
        ChangeArea::Staged => {
            args.push("--cached");
            args.extend(base);
            args.push("--");
            // both sides of a rename, so git can pair them
            args.extend(orig_path);
            args.push(path);
        }
        ChangeArea::Untracked => {
            // --no-index exits with 1 when the files differ, which is always here
            args.push("--no-index");
            args.extend(base);
            args.extend(["--", "/dev/null", path]);
            ok_codes.push(1);
        }
    }

    let out = git_checked(backend, root, &args, &ok_codes, MAX_DIFF_BYTES)?;
    let bytes = if out.truncated {
        cut_at_line(out.stdout)
    } else {
        out.stdout
    };

    Ok(UnifiedDiff {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated: out.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_relative_paths_pass() {
        assert!(checked_path("src/a.ts").is_ok());
        assert!(checked_path("./a b.ts").is_ok());
        for bad in ["", "/etc/passwd", "../outside", "src/../../outside"] {
            assert!(checked_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_cut_diff_keeps_whole_lines() {
        assert_eq!(cut_at_line(b"ab\ncd\n".to_vec()), b"ab\ncd\n");
        assert_eq!(cut_at_line(b"ab\ncd\nef".to_vec()), b"ab\ncd\n");
        assert_eq!(cut_at_line(b"abcdef".to_vec()), b"abcdef");
    }
}
