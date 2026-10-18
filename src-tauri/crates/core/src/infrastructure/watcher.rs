//! Watches the working tree and the git dir, and reports what changed after a quiet period.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::notify::{
    self, Config, Event, EventHandler, EventKind, PathsMut, RecommendedWatcher, RecursiveMode,
    Watcher, WatcherKind,
};
use notify_debouncer_mini::{new_debouncer_opt, DebounceEventResult};

use crate::modules::repository::{RepositoryWatcher, Watch};

/// Long enough to fold an agent's burst of writes into one refresh.
const QUIET_PERIOD: Duration = Duration::from_millis(250);

/// Watches this machine's files (notify: FSEvents, inotify, `ReadDirectoryChangesW`).
pub struct LocalRepositoryWatcher;

impl RepositoryWatcher for LocalRepositoryWatcher {
    /// `on_change` runs on the watcher's thread.
    fn watch(
        &self,
        root: &Path,
        git_dir: &Path,
        mut on_change: Box<dyn FnMut(Vec<PathBuf>) + Send>,
    ) -> anyhow::Result<Watch> {
        let config = notify_debouncer_mini::Config::default().with_timeout(QUIET_PERIOD);
        let mut debouncer =
            new_debouncer_opt::<_, ChangesOnly>(config, move |result: DebounceEventResult| {
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

/// The system's watcher without the reads. inotify reports a file opened, or closed unwritten
/// (`IN_OPEN`, `IN_CLOSE_NOWRITE`): every git command run on the repository would report its own
/// reads and refresh the app again, without end. The debouncer drops an event's kind, so they are
/// dropped before it, as Zed does (`crates/fs/src/fs_watcher.rs`, `enqueue`).
struct ChangesOnly(RecommendedWatcher);

impl Watcher for ChangesOnly {
    fn new<F: EventHandler>(mut event_handler: F, config: Config) -> notify::Result<Self> {
        let changes = move |event: notify::Result<Event>| {
            if !matches!(
                &event,
                Ok(Event {
                    kind: EventKind::Access(_),
                    ..
                })
            ) {
                event_handler.handle_event(event);
            }
        };
        RecommendedWatcher::new(changes, config).map(Self)
    }

    fn watch(&mut self, path: &Path, recursive_mode: RecursiveMode) -> notify::Result<()> {
        self.0.watch(path, recursive_mode)
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.0.unwatch(path)
    }

    fn paths_mut<'me>(&'me mut self) -> Box<dyn PathsMut + 'me> {
        self.0.paths_mut()
    }

    fn configure(&mut self, option: Config) -> notify::Result<bool> {
        self.0.configure(option)
    }

    fn kind() -> WatcherKind {
        RecommendedWatcher::kind()
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

    #[test]
    fn a_read_is_not_a_change() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/index"), "index").unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        let _watch = LocalRepositoryWatcher
            .watch(
                &root,
                &root.join(".git"),
                Box::new(move |paths| {
                    let _ = sent.send(paths);
                }),
            )
            .unwrap();
        // FSEvents may first report what happened just before the watch started
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while received.recv_timeout(Duration::from_secs(1)).is_ok() {
            assert!(
                std::time::Instant::now() < deadline,
                "the watcher never went quiet"
            );
        }

        // what git does on every command: read the index
        std::fs::read(root.join(".git/index")).unwrap();
        if let Ok(paths) = received.recv_timeout(Duration::from_secs(1)) {
            panic!("a read reported {paths:?}");
        }
    }
}
