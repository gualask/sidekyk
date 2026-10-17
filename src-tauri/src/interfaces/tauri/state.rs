//! Managed Tauri state: the projects, the watcher of the one on screen, whether the window shows,
//! and the one place that changes them.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use super::tray;
use crate::infrastructure::git_cli::LocalRepositoryBackend;
use crate::infrastructure::settings_store;
use crate::infrastructure::watcher::{RepositoryWatcher, WatchedChanges};
use crate::modules::projects::ProjectList;
use crate::modules::repository::{
    self, resolve_repository, ChangedFile, FileContent, FileTree, IgnoredPaths, RepositoryBackend,
    RepositoryChangedEvent, RepositoryInfo, RepositorySnapshot, RepositorySummary, Visible,
    REPOSITORY_CHANGED_EVENT,
};
use crate::modules::search::{
    self, ContentEnd, ContentFile, ContentSearch, ProjectFiles, SearchRequest, SearchResults,
};
use crate::shared::coalesce::Coalesced;
use crate::shared::error::{unshare, user_facing, UserFacingErrorCode};
use crate::shared::sync::lock;

/// A result shared by every caller that waited for it.
type Shared<T> = Result<T, Arc<anyhow::Error>>;

/// One computation per project at a time; requests that arrive during it share the next one.
struct PerProject<T> {
    runs: Mutex<HashMap<String, Arc<Coalesced<Shared<T>>>>>,
}

impl<T> Default for PerProject<T> {
    fn default() -> Self {
        Self {
            runs: Mutex::default(),
        }
    }
}

impl<T: Clone> PerProject<T> {
    fn run(&self, root: &str, work: impl FnOnce() -> anyhow::Result<T>) -> anyhow::Result<T> {
        let coalesced = lock(&self.runs)
            .entry(root.to_string())
            .or_default()
            .clone();
        coalesced.run(|| work().map_err(Arc::new)).map_err(unshare)
    }

    /// Forgets the projects no longer in the list.
    fn retain(&self, list: &ProjectList) {
        lock(&self.runs).retain(|root, _| list.find(root).is_ok());
    }
}

/// While the window is minimized, hidden or covered, as its page tells, the watcher keeps
/// watching but reports nothing, and only marks what it saw.
#[derive(Default)]
struct WindowState {
    hidden: bool,
    /// The project on screen, when its watcher saw a change that may show while hidden.
    missed: Option<String>,
}

/// A project's files, as the Files panel shows them.
#[derive(Default)]
struct CachedTree {
    tree: Option<Arc<FileTree>>,
    /// Counts the times the files may have changed, so a tree read meanwhile is not kept.
    changes: u64,
}

struct Watched {
    root: String,
    /// `None` when the watcher could not start, such as a repository moved away.
    _watcher: Option<RepositoryWatcher>,
}

#[derive(Default)]
pub(crate) struct ProjectsState {
    list: Mutex<ProjectList>,
    /// Only the project on screen is watched. Kept apart from `list`, since starting a watcher
    /// can take a while (on Linux it walks the tree) and must not hold up snapshots.
    watched: Mutex<Option<Watched>>,
    /// Kept apart from `watched`, which is held while a watcher starts: the page reports its
    /// visibility on the main thread, which must not wait for that.
    window: Mutex<WindowState>,
    snapshots: PerProject<RepositorySnapshot>,
    /// Every project on screen asks for its summary at once.
    summaries: PerProject<RepositorySummary>,
    /// The changed files of each project's last snapshot, which the palette searches without
    /// running git. Only the project on screen has snapshots.
    changed: Mutex<HashMap<String, Arc<[ChangedFile]>>>,
    /// The files of the project on screen: read when first asked for, and again only after its
    /// watcher saw a file added or removed, or the git dir change.
    trees: Mutex<HashMap<String, CachedTree>>,
    tree_reads: PerProject<Arc<FileTree>>,
    /// The last search in contents that read every file it was given, for the next one to read
    /// only the files it found when the text grew. Dropped at any change the watcher sees.
    contents: Mutex<Option<LastContents>>,
    /// Counts the searches in contents started or stopped: a search goes on while it is the last.
    content_runs: AtomicU64,
}

/// A complete search in contents: in which tree, for what, and the files where it found it.
struct LastContents {
    root: String,
    tree: Arc<FileTree>,
    query: String,
    files: Arc<[String]>,
}

impl ProjectsState {
    pub(crate) fn list(&self) -> ProjectList {
        lock(&self.list).clone()
    }

    /// The project on screen.
    pub(crate) fn active(&self) -> Option<RepositoryInfo> {
        lock(&self.list).active().cloned()
    }

    /// A project the user added. Any other root is refused, so the frontend cannot point git
    /// at a folder of its choosing.
    pub(crate) fn project(&self, root: &str) -> anyhow::Result<RepositoryInfo> {
        lock(&self.list).find(root).cloned()
    }

    /// A project's snapshot, sharing the one in flight.
    pub(crate) fn snapshot(
        &self,
        backend: &dyn RepositoryBackend,
        root: &str,
    ) -> anyhow::Result<RepositorySnapshot> {
        let project = self.project(root)?;
        self.snapshots.run(root, || {
            let snapshot = repository::load_snapshot(backend, &project);
            let mut changed = lock(&self.changed);
            match &snapshot {
                Ok(snapshot) => {
                    changed.insert(root.to_string(), snapshot.files.as_slice().into());
                }
                // a repository moved away has nothing left to search
                Err(_) => {
                    changed.remove(root);
                }
            }
            snapshot
        })
    }

    /// The palette's matches: the projects, the panels the frontend names, and the files of the
    /// project asked for, as its tree lists them (read if not yet) and its last snapshot found
    /// them changed. A project whose files cannot be read offers none.
    pub(crate) fn search(
        &self,
        backend: &dyn RepositoryBackend,
        request: &SearchRequest,
    ) -> SearchResults {
        let list = self.list();
        search::search(request, &list.projects, |root| {
            let tree = self
                .file_tree(backend, root)
                .inspect_err(
                    |error| tracing::debug!(error = %format!("{error:#}"), "no files to search"),
                )
                .ok()?;
            let changed = lock(&self.changed)
                .get(root)
                .cloned()
                .unwrap_or_else(|| Arc::from([]));
            Some(ProjectFiles { tree, changed })
        })
    }

    /// A project's files, read again only when they may have changed, sharing the read in flight.
    pub(crate) fn file_tree(
        &self,
        backend: &dyn RepositoryBackend,
        root: &str,
    ) -> anyhow::Result<Arc<FileTree>> {
        let project = self.project(root)?;
        let cached = || lock(&self.trees).get(root).and_then(|c| c.tree.clone());
        if let Some(tree) = cached() {
            return Ok(tree);
        }
        self.tree_reads.run(root, || {
            // the read this one waited for may have left a tree
            if let Some(tree) = cached() {
                return Ok(tree);
            }
            let before = lock(&self.trees)
                .entry(root.to_string())
                .or_default()
                .changes;
            let tree = Arc::new(repository::load_file_tree(backend, &project)?);
            let mut trees = lock(&self.trees);
            let entry = trees.entry(root.to_string()).or_default();
            if entry.changes == before {
                entry.tree = Some(tree.clone());
            }
            Ok(tree)
        })
    }

    /// One file of a project's tree. Only a file of the tree is read, so never one git ignores.
    pub(crate) fn file_content(
        &self,
        backend: &dyn RepositoryBackend,
        root: &str,
        path: &str,
    ) -> anyhow::Result<FileContent> {
        if !self.file_tree(backend, root)?.contains_file(path) {
            return Err(user_facing(UserFacingErrorCode::FileMissing));
        }
        repository::load_file_content(backend, &self.project(root)?, path)
    }

    /// The lines of a project's files where `query` is, sent to `send` as they are found. A newer
    /// search, or `stop_content_search`, stops this one. When the text grew from the last
    /// complete search's, in the same files and with nothing changed since, only the files it
    /// found are read.
    pub(crate) fn search_contents(
        &self,
        backend: &dyn RepositoryBackend,
        root: &str,
        query: &str,
        send: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd> {
        let run = self.content_runs.fetch_add(1, Ordering::Relaxed) + 1;
        let cancelled = || self.content_runs.load(Ordering::Relaxed) != run;
        let tree = self.file_tree(backend, root)?;
        let narrowed = lock(&self.contents)
            .as_ref()
            .filter(|last| {
                last.root == root
                    && Arc::ptr_eq(&last.tree, &tree)
                    && search::narrows(&last.query, query)
            })
            .map(|last| last.files.clone());
        let files: Vec<&str> = match &narrowed {
            Some(files) => files.iter().map(String::as_str).collect(),
            None => tree.files().iter().map(String::as_str).collect(),
        };
        let searched = search::search_contents(
            &ContentSearch {
                backend,
                root: Path::new(root),
                files: &files,
                query,
            },
            &cancelled,
            send,
        );
        let cancelled = cancelled();
        if !cancelled && !searched.cut {
            *lock(&self.contents) = Some(LastContents {
                root: root.to_string(),
                tree,
                query: query.to_string(),
                files: searched.files.into(),
            });
        }
        Ok(ContentEnd {
            more: searched.cut,
            cancelled,
        })
    }

    /// Stops the search in contents going on, if any: the palette closed.
    pub(crate) fn stop_content_search(&self) {
        self.content_runs.fetch_add(1, Ordering::Relaxed);
    }

    /// A file may have changed: a search in contents reads every file again.
    fn forget_contents(&self) {
        lock(&self.contents).take();
    }

    /// The files of a project may have changed: its tree is read again when next asked for.
    fn forget_tree(&self, root: &str) {
        let mut trees = lock(&self.trees);
        let entry = trees.entry(root.to_string()).or_default();
        entry.tree = None;
        entry.changes += 1;
    }

    /// Whether a batch of the watcher may have added or removed a file of the tree read.
    fn batch_changes_tree(&self, root: &str, git_dir: bool, visible: &Visible) -> bool {
        let trees = lock(&self.trees);
        let Some(tree) = trees.get(root).and_then(|c| c.tree.as_ref()) else {
            // nothing read, nothing to read again
            return false;
        };
        git_dir
            || match visible {
                Visible::Unknown => true,
                Visible::Paths(paths) => tree.may_have_changed(Path::new(root), paths),
            }
    }

    /// A project's summary, sharing the one in flight.
    pub(crate) fn summary(
        &self,
        backend: &dyn RepositoryBackend,
        root: &str,
    ) -> anyhow::Result<RepositorySummary> {
        let project = self.project(root)?;
        self.summaries
            .run(root, || repository::load_summary(backend, &project))
    }

    /// Records whether the window shows. Showing again returns the project on screen if its
    /// watcher saw a change meanwhile, for the frontend to read again.
    pub(crate) fn set_window_visible(&self, visible: bool) -> Option<String> {
        let mut window = lock(&self.window);
        window.hidden = !visible;
        let missed = if visible { window.missed.take() } else { None };
        tracing::debug!(visible, missed = missed.is_some(), "window visibility");
        missed
    }

    /// Replaces the list at startup, before anything is watched.
    pub(crate) fn restore(&self, list: ProjectList) {
        *lock(&self.list) = list;
    }

    /// Changes the list, stores it, and watches the project now on screen.
    pub(crate) fn update(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<()>,
    ) -> anyhow::Result<ProjectList> {
        let list = {
            let mut list = lock(&self.list);
            change(&mut list)?;
            // stored while still locked, so concurrent changes reach the disk in their order
            if let Err(error) = settings_store::save_projects(app, &list) {
                tracing::warn!(error = %format!("{error:#}"), "could not store the projects");
            }
            list.clone()
        };
        self.snapshots.retain(&list);
        self.summaries.retain(&list);
        self.tree_reads.retain(&list);
        lock(&self.changed).retain(|root, _| list.find(root).is_ok());
        watch_active(app);
        Ok(list)
    }
}

/// Watches the project on screen, if it is not watched yet, and stops watching the previous one.
/// Calls racing each other end on the project on screen after the last of them.
pub(crate) fn watch_active(app: &tauri::AppHandle) {
    let state = app.state::<ProjectsState>();
    let mut watched = lock(&state.watched);
    let Some(active) = state.active() else {
        *watched = None;
        tray::clear(app);
        return;
    };
    if watched.as_ref().is_some_and(|w| w.root == active.root) {
        return;
    }
    // the previous watcher stops before the next one walks its tree
    *watched = None;
    // a project put on screen is read in full anyway, and its first snapshot fills the tray
    lock(&state.window).missed = None;
    // what the previous watcher saw is gone with it: the files are read again when asked for
    lock(&state.trees).clear();
    tray::clear(app);
    let watcher = match start_watcher(app, &active.root) {
        Ok(watcher) => {
            tracing::info!(root = %active.root, "project opened");
            Some(watcher)
        }
        Err(error) => {
            tracing::warn!(
                root = %active.root,
                error = %format!("{error:#}"),
                "could not watch the project"
            );
            None
        }
    };
    *watched = Some(Watched {
        root: active.root,
        _watcher: watcher,
    });
}

fn start_watcher(app: &tauri::AppHandle, root: &str) -> anyhow::Result<RepositoryWatcher> {
    let backend = app.state::<LocalRepositoryBackend>();
    let resolved = resolve_repository(backend.inner(), Path::new(root))?;

    let emitter = app.clone();
    let root = resolved.info.root;
    let mut ignored = IgnoredPaths::new(root.clone().into());
    let watched_root = root.clone();
    let on_change = move |changes: WatchedChanges| {
        // The index may now track a file in an ignored directory, or the excludes changed.
        if changes.git_dir {
            ignored.forget();
        }
        let state = emitter.state::<ProjectsState>();
        // held until the batch is settled, so the window cannot show in between and miss it
        let mut window = lock(&state.window);
        // nobody looks: no `check-ignore`, no refresh, only a mark for when the window shows
        if window.hidden {
            let marked = changes.git_dir || ignored.any_maybe_visible(&changes.worktree);
            if marked {
                window.missed = Some(watched_root.clone());
                state.forget_tree(&watched_root);
                state.forget_contents();
            }
            tracing::debug!(
                git_dir = changes.git_dir,
                worktree_paths = changes.worktree.len(),
                marked,
                "watcher batch while hidden"
            );
            return;
        }
        drop(window);
        let backend = emitter.state::<LocalRepositoryBackend>();
        let worktree = ignored.visible(backend.inner(), &changes.worktree);
        let visible = changes.git_dir || worktree.any();
        let files = state.batch_changes_tree(&watched_root, changes.git_dir, &worktree);
        if files {
            state.forget_tree(&watched_root);
        }
        tracing::debug!(
            git_dir = changes.git_dir,
            worktree_paths = changes.worktree.len(),
            visible,
            files,
            "watcher batch"
        );
        if visible {
            state.forget_contents();
            let event = RepositoryChangedEvent::new(&watched_root, changes.git_dir);
            let _ = emitter.emit(REPOSITORY_CHANGED_EVENT, event);
        }
    };
    RepositoryWatcher::start(root.clone().into(), resolved.git_dir, on_change)
}

/// Adds the repository that contains `candidate` and puts it on screen.
pub(crate) fn open_folder(app: &tauri::AppHandle, candidate: &Path) -> anyhow::Result<ProjectList> {
    let backend = app.state::<LocalRepositoryBackend>();
    let info = resolve_repository(backend.inner(), candidate)?.info;
    app.state::<ProjectsState>().update(app, |list| {
        list.add(info);
        Ok(())
    })
}
