//! Which changes the watcher saw matter to what the app shows.

use std::path::{Component, Path, PathBuf};

/// The parts of the git dir that change what the app shows: the index (staging), HEAD and refs
/// (branch, commits, ahead/behind), and `info/exclude` (which files are untracked). Objects and
/// logs churn on every commit and say nothing new.
const GIT_DIR_ENTRIES: [&str; 7] = [
    "index",
    "HEAD",
    "refs",
    "packed-refs",
    "FETCH_HEAD",
    "MERGE_HEAD",
    "info",
];

/// What changed during one quiet period.
#[derive(Debug, Default, PartialEq)]
pub struct WatchedChanges {
    /// The index, HEAD, refs or the exclude file changed.
    pub git_dir: bool,
    /// Changed paths in the working tree, absolute. Some of them may be ignored by git.
    pub worktree: Vec<PathBuf>,
}

impl WatchedChanges {
    /// Whether nothing in the batch matters.
    pub fn is_empty(&self) -> bool {
        !self.git_dir && self.worktree.is_empty()
    }
}

/// Sorts the paths the watcher reported (absolute) into the git dir's entries that matter and
/// the working tree's paths; the rest of the git dir (objects, logs, locks) is dropped.
pub fn classify<'a>(
    paths: impl Iterator<Item = &'a Path>,
    root: &Path,
    git_dir: &Path,
) -> WatchedChanges {
    let mut changes = WatchedChanges::default();
    for path in paths {
        if let Ok(inside_git_dir) = path.strip_prefix(git_dir) {
            let is_lock = path.extension().is_some_and(|ext| ext == "lock");
            let first = inside_git_dir.components().next();
            changes.git_dir |= !is_lock
                && matches!(first, Some(Component::Normal(name)) if GIT_DIR_ENTRIES.iter().any(|e| name == *e));
        } else if path.starts_with(root) {
            changes.worktree.push(path.to_path_buf());
        }
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn changes(paths: &[&str], root: &str, git_dir: &str) -> WatchedChanges {
        classify(
            paths.iter().map(Path::new),
            Path::new(root),
            Path::new(git_dir),
        )
    }

    #[test]
    fn index_refs_and_excludes_count_but_objects_and_locks_do_not() {
        let git_dir_counts = |p: &str| changes(&[p], "/r", "/r/.git").git_dir;

        assert!(git_dir_counts("/r/.git/index"));
        assert!(git_dir_counts("/r/.git/HEAD"));
        assert!(git_dir_counts("/r/.git/refs/heads/main"));
        assert!(git_dir_counts("/r/.git/info/exclude"));
        assert!(!git_dir_counts("/r/.git/index.lock"));
        assert!(!git_dir_counts("/r/.git/refs/heads/main.lock"));
        assert!(!git_dir_counts("/r/.git/objects/ab/cdef"));
        assert!(!git_dir_counts("/r/.git/logs/HEAD"));
        assert!(!git_dir_counts("/r/.git"));
    }

    #[test]
    fn worktree_paths_are_collected_and_the_git_dir_never_is() {
        assert_eq!(
            changes(
                &[
                    "/r/src/a.ts",
                    "/r/.git/objects/ab",
                    "/elsewhere/a.ts",
                    "/r/target/x.o"
                ],
                "/r",
                "/r/.git"
            ),
            WatchedChanges {
                git_dir: false,
                worktree: vec!["/r/src/a.ts".into(), "/r/target/x.o".into()],
            }
        );
    }

    #[test]
    fn a_git_dir_outside_the_root_is_still_filtered() {
        let found = changes(
            &[
                "/main/.git/worktrees/wt/index",
                "/main/.git/worktrees/wt/logs/HEAD",
                "/wt/src/a.ts",
            ],
            "/wt",
            "/main/.git/worktrees/wt",
        );
        assert!(found.git_dir);
        assert_eq!(found.worktree, vec![PathBuf::from("/wt/src/a.ts")]);
    }
}
