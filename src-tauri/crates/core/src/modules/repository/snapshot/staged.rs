//! The staged area of a snapshot: its counts, and the counts against HEAD of the paths it holds.

use std::path::Path;

use crate::modules::folder::{git_checked, joined, RepositoryBackend};
use crate::modules::repository::diff_counts::{added_up, numstat, Numstat};
use crate::modules::repository::limits::MAX_NUMSTAT_BYTES;
use crate::modules::repository::numstat::parse_name_status_z;
use crate::modules::repository::status::StatusReport;

/// The staged paths are named to git, against HEAD, while they fit in this many bytes; past it
/// the whole diff runs. Well inside Windows' 32,767-character command line.
const MAX_PATHSPEC_BYTES: usize = 16 * 1024;

/// The paths `git diff --cached` names, both sides of a rename: what is staged, without reading
/// a file's content.
struct StagedPaths {
    paths: Vec<String>,
    /// The output was cut: some staged paths are not named.
    truncated: bool,
}

fn staged_paths(backend: &dyn RepositoryBackend, root: &Path) -> anyhow::Result<StagedPaths> {
    let out = git_checked(
        backend,
        root,
        &["diff", "--cached", "--name-status", "-z", "--no-ext-diff"],
        &[0],
        MAX_NUMSTAT_BYTES,
    )?;
    Ok(StagedPaths {
        paths: parse_name_status_z(&out.stdout),
        truncated: out.truncated,
    })
}

/// Whether the staged paths can all be named to git: the list is whole, and fits in
/// `MAX_PATHSPEC_BYTES`.
fn all_nameable(staged: &StagedPaths) -> bool {
    !staged.truncated
        && staged
            .paths
            .iter()
            .map(|path| path.len() + 1)
            .sum::<usize>()
            <= MAX_PATHSPEC_BYTES
}

/// The counts against HEAD that what is staged needs. Each fails before the first commit, when it
/// is not used.
pub(super) enum StagedAgainstHead {
    /// The staged paths' own, replacing their unstaged counts.
    Paths {
        paths: Vec<String>,
        counts: anyhow::Result<Numstat>,
    },
    /// Every path's, when the staged ones cannot all be named.
    Every(anyhow::Result<Numstat>),
}

/// The staged area: its counts and, when anything is staged, what it needs against HEAD. Both
/// diffs run together once `--name-status` has named the paths, which costs about as much as an
/// empty `--cached` numstat; with nothing staged neither runs.
pub(super) fn staged_area(
    backend: &dyn RepositoryBackend,
    root: &Path,
) -> anyhow::Result<(Numstat, Option<StagedAgainstHead>)> {
    let staged = staged_paths(backend, root)?;
    if staged.paths.is_empty() && !staged.truncated {
        return Ok((Numstat::default(), None));
    }
    let named = all_nameable(&staged);
    let (counts, head) = std::thread::scope(|scope| {
        let head = scope.spawn(|| head_counts(backend, root, &staged, named));
        let counts = numstat(backend, root, &["--cached"]);
        (counts, joined(head))
    });
    let head = if named {
        StagedAgainstHead::Paths {
            paths: staged.paths,
            counts: head,
        }
    } else {
        StagedAgainstHead::Every(head)
    };
    Ok((counts?, Some(head)))
}

/// The numstat against HEAD of the staged paths when `named`, else of every path.
fn head_counts(
    backend: &dyn RepositoryBackend,
    root: &Path,
    staged: &StagedPaths,
    named: bool,
) -> anyhow::Result<Numstat> {
    if !named {
        return numstat(backend, root, &["HEAD"]);
    }
    let mut args = vec!["HEAD", "--"];
    args.extend(staged.paths.iter().map(String::as_str));
    numstat(backend, root, &args)
}

/// The line counts of tracked paths against HEAD. A path not staged has the same counts against
/// HEAD as unstaged, the index holding HEAD's version; a staged one takes its own diff against
/// HEAD, where a line edited, staged and edited again counts once. Before the first commit there
/// is no HEAD, and the areas add up.
pub(super) fn against_head(
    status: &StatusReport,
    staged: Numstat,
    unstaged: Numstat,
    of_staged: Option<StagedAgainstHead>,
) -> anyhow::Result<Numstat> {
    if status.branch.commit.is_none() {
        return Ok(added_up(staged, unstaged));
    }
    match of_staged {
        None => Ok(unstaged),
        Some(StagedAgainstHead::Every(counts)) => counts,
        Some(StagedAgainstHead::Paths { paths, counts }) => {
            let counts = counts?;
            let mut tracked = unstaged;
            for path in &paths {
                tracked.counts.remove(path);
            }
            // a staged path back to HEAD's content is not in `counts`, and counts nothing
            tracked.counts.extend(counts.counts);
            tracked.truncated |= counts.truncated;
            Ok(tracked)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_paths_are_named_while_they_fit() {
        let staged = |paths: Vec<String>, truncated| StagedPaths { paths, truncated };
        assert!(all_nameable(&staged(vec!["src/[id].ts".into()], false)));

        let name = "a".repeat(100);
        let many = (0..MAX_PATHSPEC_BYTES / 100)
            .map(|i| format!("{name}{i}"))
            .collect();
        assert!(
            !all_nameable(&staged(many, false)),
            "past the limit, the whole diff"
        );
        assert!(
            !all_nameable(&staged(vec!["a.ts".into()], true)),
            "a cut list does not name every staged path"
        );
    }
}
