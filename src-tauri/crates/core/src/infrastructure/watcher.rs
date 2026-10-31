//! Watches a project's folder and a repository's git dir, and reports what changed after a quiet
//! period, at most once per `REPORT_INTERVAL` while changes go on.

use std::fmt;
use std::io;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use notify_debouncer_mini::notify::{
    self, Config, Event, EventHandler, EventKind, PathsMut, RecommendedWatcher, RecursiveMode,
    Watcher, WatcherKind,
};
use notify_debouncer_mini::{new_debouncer_opt, DebounceEventResult, Debouncer};

use crate::modules::repository::{Changed, FolderAdded, FolderWatcher, RepositoryWatcher, Watch};
use crate::shared::sync::lock;

/// Long enough to fold an agent's burst of writes into one refresh.
const QUIET_PERIOD: Duration = Duration::from_millis(250);

/// While changes go on, the debouncer reports about 8 batches a second, each a `check-ignore` and
/// a snapshot: at most one report per interval, the first at once, the last always
/// (`docs/architecture.md`, Watching).
pub const REPORT_INTERVAL: Duration = Duration::from_secs(1);

/// Watches this machine's files (notify: FSEvents, inotify, `ReadDirectoryChangesW`).
pub struct LocalRepositoryWatcher {
    /// One watch per folder, the folders added by the caller.
    per_folder: bool,
}

impl Default for LocalRepositoryWatcher {
    /// inotify watches one folder at a time, so a recursive watch would walk the tree and watch
    /// every folder, git-ignored ones included (`node_modules/`, `target/`): there the caller adds
    /// the folders git does not ignore, as VS Code (`@parcel/watcher`) and Zed do. FSEvents and
    /// `ReadDirectoryChangesW` watch a whole tree at once.
    fn default() -> Self {
        Self {
            per_folder: cfg!(target_os = "linux"),
        }
    }
}

impl LocalRepositoryWatcher {
    /// One watch per folder on any system, as on Linux.
    #[cfg(test)]
    pub fn per_folder() -> Self {
        Self { per_folder: true }
    }
}

impl RepositoryWatcher for LocalRepositoryWatcher {
    /// `on_change` runs on the watch's own thread, which ends with the watch.
    fn watch(
        &self,
        root: &Path,
        git_dir: Option<&Path>,
        on_change: Box<dyn FnMut(Changed) + Send>,
    ) -> anyhow::Result<Watch> {
        let (batches, received) = mpsc::channel();
        std::thread::Builder::new()
            .name("watch-reports".to_string())
            .spawn(move || report_throttled(&received, on_change))?;
        let config = notify_debouncer_mini::Config::default().with_timeout(QUIET_PERIOD);
        // the debouncer's thread holds the sender: once the watch drops, the reports end
        let mut debouncer =
            new_debouncer_opt::<_, ChangesOnly>(config, move |result: DebounceEventResult| {
                if let Some(changed) = changed(result) {
                    let _ = batches.send(changed);
                }
            })?;
        if self.per_folder {
            let shared = Arc::new(Mutex::new(debouncer));
            let folders = OneFolderEach(Arc::downgrade(&shared));
            return Ok(Watch {
                guard: Box::new(shared),
                folders: Some(Arc::new(folders)),
            });
        }
        debouncer.watcher().watch(root, RecursiveMode::Recursive)?;
        if let Some(git_dir) = git_dir.filter(|git_dir| !git_dir.starts_with(root)) {
            debouncer
                .watcher()
                .watch(git_dir, RecursiveMode::Recursive)?;
        }
        Ok(Watch {
            guard: Box::new(debouncer),
            folders: None,
        })
    }
}

/// Adds folders to a watch while it lasts, without keeping it alive.
struct OneFolderEach(Weak<Mutex<Debouncer<ChangesOnly>>>);

impl FolderWatcher for OneFolderEach {
    fn add(&self, folder: &Path) -> FolderAdded {
        let Some(shared) = self.0.upgrade() else {
            return FolderAdded::Skipped;
        };
        let mut debouncer = lock(&shared);
        match debouncer
            .watcher()
            .watch(folder, RecursiveMode::NonRecursive)
        {
            Ok(()) => FolderAdded::Watched,
            Err(error) if matches!(error.kind, notify::ErrorKind::MaxFilesWatch) => {
                FolderAdded::Full
            }
            Err(error) => {
                tracing::debug!(folder = %folder.display(), %error, "folder not watched");
                FolderAdded::Skipped
            }
        }
    }
}

/// Tells each batch received, throttled, until the debouncer stops.
fn report_throttled(received: &Receiver<Changed>, mut on_change: Box<dyn FnMut(Changed) + Send>) {
    let mut throttle = Throttle::new(REPORT_INTERVAL);
    loop {
        let next = match throttle.due_at() {
            Some(due) => received.recv_timeout(due.saturating_duration_since(Instant::now())),
            None => received.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        let told = match next {
            Ok(changed) => throttle.offer(changed, Instant::now()),
            Err(RecvTimeoutError::Timeout) => throttle.release(Instant::now()),
            // the watch is gone: what is held concerns nobody
            Err(RecvTimeoutError::Disconnected) => return,
        };
        if let Some(changed) = told {
            on_change(changed);
        }
    }
}

/// Batches told at most once per interval: the first after a quiet interval at once, those that
/// come before the interval ends held and told together when it does. No timer while idle.
struct Throttle {
    interval: Duration,
    last_told: Option<Instant>,
    /// Always within the interval of `last_told`.
    held: Option<Changed>,
}

impl Throttle {
    fn new(interval: Duration) -> Self {
        Self {
            interval,
            last_told: None,
            held: None,
        }
    }

    /// A batch received at `now`: what to tell at once, if anything.
    fn offer(&mut self, changed: Changed, now: Instant) -> Option<Changed> {
        let quiet = self
            .last_told
            .is_none_or(|told| now.saturating_duration_since(told) >= self.interval);
        if self.held.is_none() && quiet {
            self.last_told = Some(now);
            return Some(changed);
        }
        self.held = Some(match self.held.take() {
            Some(held) => joined(held, changed),
            None => changed,
        });
        None
    }

    /// When the batches held are due.
    fn due_at(&self) -> Option<Instant> {
        let told = self.last_told?;
        self.held.as_ref().map(|_| told + self.interval)
    }

    /// The batches held, told at `now`.
    fn release(&mut self, now: Instant) -> Option<Changed> {
        let held = self.held.take()?;
        self.last_told = Some(now);
        Some(held)
    }
}

/// Two batches as one: every path once, any if either lost events.
fn joined(first: Changed, second: Changed) -> Changed {
    match (first, second) {
        (Changed::Paths(mut paths), Changed::Paths(more)) => {
            paths.extend(more);
            paths.sort_unstable();
            paths.dedup();
            Changed::Paths(paths)
        }
        _ => Changed::Unknown,
    }
}

/// What a batch of the debouncer tells, if anything.
fn changed(result: DebounceEventResult) -> Option<Changed> {
    match result {
        Ok(events) if events.is_empty() => None,
        Ok(events) => Some(Changed::Paths(events.into_iter().map(|e| e.path).collect())),
        Err(error) if is_events_lost(&error) => {
            tracing::info!("the system dropped the watcher's events");
            Some(Changed::Unknown)
        }
        Err(error) => {
            tracing::warn!(%error, "watcher error");
            None
        }
    }
}

/// The system dropped events, its queue full (inotify's `IN_Q_OVERFLOW`, FSEvents'
/// `MustScanSubDirs`; Windows from notify 9: `docs/architecture.md`, Watching). notify sends an
/// event without paths, which the debouncer drops: it goes as this error, which the debouncer hands
/// on at once.
#[derive(Debug)]
struct EventsLost;

impl fmt::Display for EventsLost {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("the system dropped events")
    }
}

impl std::error::Error for EventsLost {}

fn is_events_lost(error: &notify::Error) -> bool {
    matches!(&error.kind, notify::ErrorKind::Io(error)
        if error.get_ref().is_some_and(|inner| inner.is::<EventsLost>()))
}

/// An event of the system as the debouncer gets it: a read dropped, events the system dropped
/// as `EventsLost`.
fn sift(event: notify::Result<Event>) -> Option<notify::Result<Event>> {
    match event {
        Ok(Event {
            kind: EventKind::Access(_),
            ..
        }) => None,
        Ok(event) if event.need_rescan() => {
            Some(Err(notify::Error::io(io::Error::other(EventsLost))))
        }
        event => Some(event),
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
            if let Some(event) = sift(event) {
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
    use notify::event::{AccessKind, CreateKind, Flag};
    use std::path::PathBuf;

    /// The paths a watcher reported; these tests drop no event.
    fn paths_of(changed: Changed) -> Vec<PathBuf> {
        match changed {
            Changed::Paths(paths) => paths,
            Changed::Unknown => panic!("the system dropped events"),
        }
    }

    #[test]
    fn events_the_system_dropped_reach_the_caller_as_unknown() {
        // how notify tells an overflow: no path, a flag
        let overflow = Event::new(EventKind::Other).set_flag(Flag::Rescan);
        let Some(Err(error)) = sift(Ok(overflow)) else {
            panic!("an overflow goes on as an error");
        };
        assert!(is_events_lost(&error));
        assert_eq!(changed(Err(error)), Some(Changed::Unknown));

        // a read stops here, a write goes on as it came, another error is no overflow
        assert!(sift(Ok(Event::new(EventKind::Access(AccessKind::Any)))).is_none());
        let created =
            Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from("/r/a.ts"));
        assert!(matches!(
            sift(Ok(created)),
            Some(Ok(event)) if event.paths == [PathBuf::from("/r/a.ts")]
        ));
        assert_eq!(changed(Err(notify::Error::generic("gone"))), None);
    }

    fn paths(names: &[&str]) -> Changed {
        Changed::Paths(names.iter().map(PathBuf::from).collect())
    }

    #[test]
    fn batches_go_on_at_most_once_per_interval_the_first_at_once_the_last_always() {
        let second = Duration::from_secs(1);
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut throttle = Throttle::new(second);
        assert_eq!(throttle.due_at(), None);

        // the first at once, no timer
        assert_eq!(
            throttle.offer(paths(&["/r/a"]), at(0)),
            Some(paths(&["/r/a"]))
        );
        assert_eq!(throttle.due_at(), None);

        // those within the interval held together, each path once, due when it ends
        assert_eq!(throttle.offer(paths(&["/r/b", "/r/a"]), at(250)), None);
        assert_eq!(throttle.offer(paths(&["/r/b", "/r/c"]), at(500)), None);
        assert_eq!(throttle.due_at(), Some(at(1_000)));
        assert_eq!(
            throttle.release(at(1_000)),
            Some(paths(&["/r/a", "/r/b", "/r/c"]))
        );
        assert_eq!(throttle.due_at(), None);

        // still going on: the next interval counts from that report
        assert_eq!(throttle.offer(paths(&["/r/d"]), at(1_250)), None);
        assert_eq!(throttle.due_at(), Some(at(2_000)));
        assert_eq!(throttle.release(at(2_000)), Some(paths(&["/r/d"])));
        assert_eq!(throttle.release(at(2_100)), None);

        // a quiet interval: at once again
        assert_eq!(
            throttle.offer(paths(&["/r/e"]), at(3_000)),
            Some(paths(&["/r/e"]))
        );

        // events lost among those held: any path may have changed
        assert_eq!(throttle.offer(paths(&["/r/f"]), at(3_100)), None);
        assert_eq!(throttle.offer(Changed::Unknown, at(3_200)), None);
        assert_eq!(throttle.offer(paths(&["/r/g"]), at(3_300)), None);
        assert_eq!(throttle.release(at(4_000)), Some(Changed::Unknown));
    }

    /// Where the system watches one folder at a time, the folders the tests write in.
    fn add_folders(watch: &Watch, folders: &[PathBuf]) {
        if let Some(watcher) = &watch.folders {
            for folder in folders {
                assert_eq!(watcher.add(folder), FolderAdded::Watched);
            }
        }
    }

    #[test]
    fn a_write_reaches_the_callback_until_the_watch_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        // the path the watcher reports: macOS gives `/private/var/…` for `/var/…`
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        let watch = LocalRepositoryWatcher::default()
            .watch(
                &root,
                Some(&root.join(".git")),
                Box::new(move |changed| {
                    let _ = sent.send(paths_of(changed));
                }),
            )
            .unwrap();
        add_folders(&watch, std::slice::from_ref(&root));

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
        let watch = LocalRepositoryWatcher::default()
            .watch(
                &root,
                Some(&root.join(".git")),
                Box::new(move |changed| {
                    let _ = sent.send(paths_of(changed));
                }),
            )
            .unwrap();
        add_folders(&watch, &[root.clone(), root.join(".git")]);
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
