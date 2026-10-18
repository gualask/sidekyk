//! Watches the working tree and the git dir, and reports what changed after a quiet period.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};

use crate::modules::repository::{RepositoryWatcher, Watch};

/// Long enough to fold an agent's burst of writes into one refresh.
const QUIET_PERIOD: Duration = Duration::from_millis(250);

/// Watches this machine's files (notify: FSEvents, inotify, `ReadDirectoryChangesW`).
pub(crate) struct LocalRepositoryWatcher;

impl RepositoryWatcher for LocalRepositoryWatcher {
    /// `on_change` runs on the watcher's thread.
    fn watch(
        &self,
        root: &Path,
        git_dir: &Path,
        mut on_change: Box<dyn FnMut(Vec<PathBuf>) + Send>,
    ) -> anyhow::Result<Watch> {
        let mut debouncer = new_debouncer(QUIET_PERIOD, move |result: DebounceEventResult| {
            let events = match result {
                Ok(events) => events,
                Err(error) => {
                    tracing::warn!(%error, "watcher error");
                    return;
                }
            };
            if !events.is_empty() {
                on_change(events.into_iter().map(|e| e.path).collect());
            }
        })?;
        debouncer.watcher().watch(root, RecursiveMode::Recursive)?;
        if !git_dir.starts_with(root) {
            debouncer
                .watcher()
                .watch(git_dir, RecursiveMode::Recursive)?;
        }
        Ok(Box::new(debouncer))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_write_reaches_the_callback_until_the_watch_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        // the path the watcher reports: macOS gives `/private/var/…` for `/var/…`
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        let watch = LocalRepositoryWatcher
            .watch(
                &root,
                &root.join(".git"),
                Box::new(move |paths| {
                    let _ = sent.send(paths);
                }),
            )
            .unwrap();

        // FSEvents may first report what happened just before the watch started
        std::fs::write(root.join("a.ts"), "").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let has = |paths: &[PathBuf], name: &str| paths.contains(&root.join(name));
        while !has(
            &received.recv_timeout(Duration::from_secs(10)).unwrap(),
            "a.ts",
        ) {
            assert!(std::time::Instant::now() < deadline, "a.ts never reported");
        }

        drop(watch);
        std::fs::write(root.join("b.ts"), "").unwrap();
        // batches already on their way may still arrive, never one with b.ts
        while let Ok(paths) = received.recv_timeout(Duration::from_secs(1)) {
            assert!(!has(&paths, "b.ts"));
        }
    }
}
