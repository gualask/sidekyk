use std::path::{Component, Path};

use super::contracts::{ChangeArea, FileDiff, FileDiffRequest, RepositoryInfo};
use super::ports::{git_checked, RepositoryBackend};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// Larger diffs are cut at the last whole line before this size.
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

/// Only a plain relative path may reach git: no `..`, no absolute path, nothing that names a
/// file outside the repository.
fn checked_path(path: &str) -> anyhow::Result<&str> {
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

fn truncate_at_line(mut bytes: Vec<u8>, max: usize) -> (Vec<u8>, bool) {
    if bytes.len() <= max {
        return (bytes, false);
    }
    let cut = bytes[..max]
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(max, |i| i + 1);
    bytes.truncate(cut);
    (bytes, true)
}

pub(crate) fn load_file_diff(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    request: &FileDiffRequest,
) -> anyhow::Result<FileDiff> {
    let path = checked_path(&request.path)?;
    let orig_path = request.orig_path.as_deref().map(checked_path).transpose()?;
    let base = ["--no-color", "--no-ext-diff", "-U3"];

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

    let stdout = git_checked(backend, Path::new(&repository.root), &args, &ok_codes)?;
    let (bytes, truncated) = truncate_at_line(stdout, MAX_DIFF_BYTES);

    Ok(FileDiff {
        path: request.path.clone(),
        area: request.area,
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
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
    fn truncation_keeps_whole_lines() {
        assert_eq!(
            truncate_at_line(b"ab\ncd\n".to_vec(), 10),
            (b"ab\ncd\n".to_vec(), false)
        );
        assert_eq!(
            truncate_at_line(b"ab\ncd\nef".to_vec(), 7),
            (b"ab\ncd\n".to_vec(), true)
        );
        assert_eq!(
            truncate_at_line(b"abcdef".to_vec(), 3),
            (b"abc".to_vec(), true)
        );
    }
}
