//! Watches the working tree and the git dir, and reports a change after a quiet period.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};

/// Long enough to fold an agent's burst of writes into one refresh.
const QUIET_PERIOD: Duration = Duration::from_millis(250);

/// The parts of the git dir that change what the app shows: the index (staging), HEAD and refs
/// (branch, commits, ahead/behind). Objects and logs churn on every commit and say nothing new.
const GIT_DIR_ENTRIES: [&str; 6] = [
    "index",
    "HEAD",
    "refs",
    "packed-refs",
    "FETCH_HEAD",
    "MERGE_HEAD",
];

fn is_relevant(path: &Path, root: &Path, git_dir: &Path) -> bool {
    if let Ok(inside_git_dir) = path.strip_prefix(git_dir) {
        let is_lock = path.extension().is_some_and(|ext| ext == "lock");
        let first = inside_git_dir.components().next();
        return !is_lock
            && matches!(first, Some(Component::Normal(name)) if GIT_DIR_ENTRIES.iter().any(|e| name == *e));
    }
    path.starts_with(root)
}

/// Stops watching when dropped.
pub(crate) struct RepositoryWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
}

impl RepositoryWatcher {
    pub(crate) fn start(
        root: PathBuf,
        git_dir: PathBuf,
        on_change: impl Fn() + Send + 'static,
    ) -> anyhow::Result<Self> {
        let (watched_root, watched_git_dir) = (root.clone(), git_dir.clone());
        let mut debouncer = new_debouncer(QUIET_PERIOD, move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            if events
                .iter()
                .any(|e| is_relevant(&e.path, &watched_root, &watched_git_dir))
            {
                on_change();
            }
        })?;
        debouncer.watcher().watch(&root, RecursiveMode::Recursive)?;
        if !git_dir.starts_with(&root) {
            debouncer
                .watcher()
                .watch(&git_dir, RecursiveMode::Recursive)?;
        }
        Ok(Self {
            _debouncer: debouncer,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_files_and_index_or_refs_count_but_objects_and_locks_do_not() {
        let root = Path::new("/r");
        let git_dir = Path::new("/r/.git");
        let relevant = |p: &str| is_relevant(Path::new(p), root, git_dir);

        assert!(relevant("/r/src/a.ts"));
        assert!(relevant("/r/.git/index"));
        assert!(relevant("/r/.git/HEAD"));
        assert!(relevant("/r/.git/refs/heads/main"));
        assert!(!relevant("/r/.git/index.lock"));
        assert!(!relevant("/r/.git/refs/heads/main.lock"));
        assert!(!relevant("/r/.git/objects/ab/cdef"));
        assert!(!relevant("/r/.git/logs/HEAD"));
        assert!(!relevant("/r/.git"));
        assert!(!relevant("/elsewhere/a.ts"));
    }

    #[test]
    fn a_git_dir_outside_the_root_is_still_filtered() {
        let relevant = |p: &str| {
            is_relevant(
                Path::new(p),
                Path::new("/wt"),
                Path::new("/main/.git/worktrees/wt"),
            )
        };
        assert!(relevant("/main/.git/worktrees/wt/index"));
        assert!(!relevant("/main/.git/worktrees/wt/logs/HEAD"));
        assert!(relevant("/wt/src/a.ts"));
    }
}
