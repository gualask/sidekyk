use super::contracts::{ChangeArea, FileDiffRequest, UnifiedDiff};
use super::limits::MAX_DIFF_BYTES;
use crate::modules::folder::{
    checked_path, cut_at_line, existing_root, git_checked, GitOutput, RepositoryBackend,
    RepositoryInfo, LITERAL_PATHSPECS,
};

/// The lines of context around each change: three, as git's default, or every line of the file
/// (git's largest), so the diff is the whole file with its changes.
pub(super) fn context_option(whole_file: bool) -> &'static str {
    if whole_file {
        "-U2147483647"
    } else {
        "-U3"
    }
}

pub fn load_file_diff(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    request: &FileDiffRequest,
) -> anyhow::Result<UnifiedDiff> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(&request.path)?;
    let orig_path = request.orig_path.as_deref().map(checked_path).transpose()?;
    let (args, ok_codes) = diff_args(request.area, path, orig_path, request.whole_file);
    let out = git_checked(backend, root, &args, &ok_codes, MAX_DIFF_BYTES)?;
    Ok(unified_diff(out))
}

/// The arguments of the diff of `path` in `area`, and the exit codes that are not a failure.
fn diff_args<'a>(
    area: ChangeArea,
    path: &'a str,
    orig_path: Option<&'a str>,
    whole_file: bool,
) -> (Vec<&'a str>, Vec<i32>) {
    let base = ["--no-color", "--no-ext-diff", context_option(whole_file)];
    let mut args = vec![LITERAL_PATHSPECS, "diff"];
    let mut ok_codes = vec![0];
    match area {
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
    (args, ok_codes)
}

/// A diff git printed, cut back to its last whole line when its output was cut.
pub(super) fn unified_diff(out: GitOutput) -> UnifiedDiff {
    let bytes = if out.truncated {
        cut_at_line(out.stdout)
    } else {
        out.stdout
    };
    UnifiedDiff {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated: out.truncated,
    }
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
