//! The repositories this process reads, as the app shows them: each one's reads shared while in
//! flight, its files kept until they may have changed, the one on screen watched. The app runs it
//! for its local projects; the helper will run it inside a WSL distro, answering over a pipe
//! (`docs/plans/remote-projects.md`). The caller checks that a repository is one the user added
//! before naming it.

mod watch;

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::modules::repository::{
    self, ChangedFile, CommitFileDiffRequest, CommitFiles, CommitRequest, Directory, FileContent,
    FileDiffRequest, FileTree, RecentCommits, RepositoryBackend, RepositoryInfo,
    RepositorySnapshot, RepositorySummary, RepositoryWatcher, UnifiedDiff,
};
use crate::modules::search::{self, ContentEnd, ContentFile, ContentSearch, FileMatches, ProjectFiles};
use crate::modules::syntax::{self, ColorCache, SyntaxColors, SyntaxRequest};
use crate::shared::coalesce::Coalesced;
use crate::shared::error::{unshare, user_facing, UserFacingErrorCode};
use crate::shared::sync::lock;

use watch::{Visibility, Watched};

/// A result shared by every caller that waited for it.
type Shared<T> = Result<T, Arc<anyhow::Error>>;

/// One computation per repository at a time; requests that arrive during it share the next one.
struct PerRepository<T> {
    runs: Mutex<HashMap<String, Arc<Coalesced<Shared<T>>>>>,
}

impl<T> Default for PerRepository<T> {
    fn default() -> Self {
        Self {
            runs: Mutex::default(),
        }
    }
}

impl<T: Clone> PerRepository<T> {
    fn run(&self, root: &str, work: impl FnOnce() -> anyhow::Result<T>) -> anyhow::Result<T> {
        let coalesced = lock(&self.runs)
            .entry(root.to_string())
            .or_default()
            .clone();
        coalesced.run(|| work().map_err(Arc::new)).map_err(unshare)
    }

    fn retain(&self, keep: &impl Fn(&str) -> bool) {
        lock(&self.runs).retain(|root, _| keep(root));
    }
}

/// A repository's files, as the Files panel shows them.
#[derive(Default)]
struct CachedTree {
    tree: Option<Arc<FileTree>>,
    /// Counts the times the files may have changed, so a tree read meanwhile is not kept.
    changes: u64,
}

/// A complete search in contents: in which tree, for what, and the files where it found it.
struct LastContents {
    root: String,
    tree: Arc<FileTree>,
    query: String,
    files: Arc<[String]>,
}

pub struct Repositories {
    backend: Arc<dyn RepositoryBackend>,
    watcher: Arc<dyn RepositoryWatcher>,
    colors: ColorCache,
    /// Only the repository on screen is watched. Kept apart from the rest, since starting a
    /// watcher can take a while (on Linux it walks the tree) and must not hold up reads.
    watched: Mutex<Option<Watched>>,
    /// Counts the repositories put on screen: a batch of a watcher replaced since is dropped.
    generation: AtomicU64,
    /// Kept apart from `watched`, which is held while a watcher starts: the app reports the
    /// window's visibility on its main thread, which must not wait for that.
    visibility: Mutex<Visibility>,
    snapshots: PerRepository<RepositorySnapshot>,
    /// Every project on screen asks for its summary at once.
    summaries: PerRepository<RepositorySummary>,
    /// The changed files of each repository's last snapshot, which the palette searches without
    /// running git. Only the repository on screen has snapshots.
    changed: Mutex<HashMap<String, Arc<[ChangedFile]>>>,
    /// The files of the repository on screen: read when first asked for, and again only after its
    /// watcher saw a file added or removed, or the git dir change.
    trees: Mutex<HashMap<String, CachedTree>>,
    tree_reads: PerRepository<Arc<FileTree>>,
    /// The last search in contents that read every file it was given, for the next one to read
    /// only the files it found when the text grew. Dropped at any change the watcher sees.
    contents: Mutex<Option<LastContents>>,
    /// Counts the searches in contents started or stopped: a search goes on while it is the last.
    content_runs: AtomicU64,
}

impl Repositories {
    pub fn new(backend: Arc<dyn RepositoryBackend>, watcher: Arc<dyn RepositoryWatcher>) -> Self {
        Self {
            backend,
            watcher,
            colors: ColorCache::default(),
            watched: Mutex::default(),
            generation: AtomicU64::new(0),
            visibility: Mutex::default(),
            snapshots: PerRepository::default(),
            summaries: PerRepository::default(),
            changed: Mutex::default(),
            trees: Mutex::default(),
            tree_reads: PerRepository::default(),
            contents: Mutex::default(),
            content_runs: AtomicU64::new(0),
        }
    }

    /// The repository that contains `candidate`, which can be any folder inside it.
    pub fn resolve(&self, candidate: &Path) -> anyhow::Result<RepositoryInfo> {
        Ok(repository::resolve_repository(&*self.backend, candidate)?.info)
    }

    /// A repository's snapshot, sharing the one in flight.
    pub fn snapshot(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySnapshot> {
        let root = info.root.as_str();
        self.snapshots.run(root, || {
            let snapshot = repository::load_snapshot(&*self.backend, info);
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

    /// A repository's summary, sharing the one in flight.
    pub fn summary(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySummary> {
        self.summaries
            .run(&info.root, || repository::load_summary(&*self.backend, info))
    }

    pub fn file_diff(
        &self,
        info: &RepositoryInfo,
        request: &FileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        repository::load_file_diff(&*self.backend, info, request)
    }

    pub fn recent_commits(&self, info: &RepositoryInfo) -> anyhow::Result<RecentCommits> {
        repository::load_recent_commits(&*self.backend, info)
    }

    pub fn commit_files(
        &self,
        info: &RepositoryInfo,
        commit: &CommitRequest,
    ) -> anyhow::Result<CommitFiles> {
        repository::load_commit_files(&*self.backend, info, commit)
    }

    pub fn commit_file_diff(
        &self,
        info: &RepositoryInfo,
        request: &CommitFileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        repository::load_commit_file_diff(&*self.backend, info, request)
    }

    /// What a folder of a repository holds, from its files in memory; `""` is the root.
    pub fn directory(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Directory> {
        Ok(self.file_tree(info)?.directory(path))
    }

    /// One file of a repository's tree. Only a file of the tree is read, so never one git ignores.
    pub fn file_content(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileContent> {
        if !self.file_tree(info)?.contains_file(path) {
            return Err(user_facing(UserFacingErrorCode::FileMissing));
        }
        repository::load_file_content(&*self.backend, info, path)
    }

    /// The syntax colors of some lines of one version of a file.
    pub fn syntax_colors(
        &self,
        info: &RepositoryInfo,
        request: &SyntaxRequest,
    ) -> anyhow::Result<SyntaxColors> {
        syntax::load_syntax_colors(&*self.backend, info, &self.colors, request)
    }

    /// The palette's matches among a repository's files: its tree (read if not yet), and how its
    /// last snapshot found them changed; none when they cannot be listed.
    pub fn search_files(&self, info: &RepositoryInfo, query: &str) -> Option<FileMatches> {
        let tree = self
            .file_tree(info)
            .inspect_err(
                |error| tracing::debug!(error = %format!("{error:#}"), "no files to search"),
            )
            .ok()?;
        let changed = lock(&self.changed)
            .get(&info.root)
            .cloned()
            .unwrap_or_else(|| Arc::from([]));
        Some(search::search_files(query, &ProjectFiles { tree, changed }))
    }

    /// The lines of a repository's files where `query` is, sent to `send` as they are found. A
    /// newer search, or `stop_content_search`, stops this one. When the text grew from the last
    /// complete search's, in the same files and with nothing changed since, only the files it
    /// found are read.
    pub fn search_contents(
        &self,
        info: &RepositoryInfo,
        query: &str,
        send: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd> {
        let run = self.content_runs.fetch_add(1, Ordering::Relaxed) + 1;
        let cancelled = || self.content_runs.load(Ordering::Relaxed) != run;
        let root = info.root.as_str();
        let tree = self.file_tree(info)?;
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
                backend: &*self.backend,
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
    pub fn stop_content_search(&self) {
        self.content_runs.fetch_add(1, Ordering::Relaxed);
    }

    /// Forgets every repository but `roots`, the ones the caller still reads.
    pub fn retain(&self, roots: &[String]) {
        let keep = |root: &str| roots.iter().any(|r| r == root);
        self.snapshots.retain(&keep);
        self.summaries.retain(&keep);
        self.tree_reads.retain(&keep);
        lock(&self.changed).retain(|root, _| keep(root));
    }

    /// A repository's files, read again only when they may have changed, sharing the read in
    /// flight.
    fn file_tree(&self, info: &RepositoryInfo) -> anyhow::Result<Arc<FileTree>> {
        let root = info.root.as_str();
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
            let tree = Arc::new(repository::load_file_tree(&*self.backend, info)?);
            let mut trees = lock(&self.trees);
            let entry = trees.entry(root.to_string()).or_default();
            if entry.changes == before {
                entry.tree = Some(tree.clone());
            }
            Ok(tree)
        })
    }

    /// A file may have changed: a search in contents reads every file again.
    fn forget_contents(&self) {
        lock(&self.contents).take();
    }

    /// The files of a repository may have changed: its tree is read again when next asked for.
    fn forget_tree(&self, root: &str) {
        let mut trees = lock(&self.trees);
        let entry = trees.entry(root.to_string()).or_default();
        entry.tree = None;
        entry.changes += 1;
    }
}
