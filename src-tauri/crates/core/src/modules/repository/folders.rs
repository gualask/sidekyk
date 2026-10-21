//! The folders to watch where the system watches one folder at a time (inotify): every folder of
//! the working tree git does not ignore, as VS Code (`@parcel/watcher`) and Zed watch on Linux,
//! and the folders of the git dir whose files `classify` counts.

use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::ignored::{changes_rules, check_ignore};
use super::ports::{FolderAdded, FolderWatcher, RepositoryBackend};
use super::watched::GIT_DIR_FOLDERS;

pub struct WatchedFolders {
    /// As git names it: git is asked about folders relative to it.
    root: PathBuf,
    watcher: Arc<dyn FolderWatcher>,
    /// Absolute.
    watched: HashSet<PathBuf>,
    /// The system's limit on watches was reached: nothing more is added.
    full: bool,
}

impl WatchedFolders {
    /// Watches the git dir's folders that count, then the working tree's folders git does not
    /// ignore, each before reading it, so a folder created meanwhile is seen.
    pub fn start(
        backend: &dyn RepositoryBackend,
        watcher: Arc<dyn FolderWatcher>,
        root: &Path,
        git_dir: &Path,
    ) -> Self {
        let mut folders = Self {
            root: root.to_path_buf(),
            watcher,
            watched: HashSet::new(),
            full: false,
        };
        // index, HEAD and the other files directly in it
        folders.add(git_dir);
        for name in GIT_DIR_FOLDERS {
            folders.add_all(backend, git_dir, PathBuf::from(name));
        }
        folders.walk(backend, vec![PathBuf::new()]);
        tracing::debug!(folders = folders.watched.len(), "folders watched");
        folders
    }

    /// Watches the folders a batch created among `paths` (relative, not ignored by git), and the
    /// folders under them git does not ignore: before the change is told, so the read it brings
    /// sees what they hold and their next changes are seen too.
    pub fn add_created(&mut self, backend: &dyn RepositoryBackend, paths: &[&Path]) {
        let created = self.created_folders(backend, paths.iter().copied());
        self.walk(backend, created);
    }

    /// Like `add_created` for paths changed while nobody looked (absolute, maybe ignored), once git
    /// may run again; looks at every folder again when a `.gitignore` was among them.
    pub fn add_missed(&mut self, backend: &dyn RepositoryBackend, paths: &[PathBuf]) {
        let root = self.root.clone();
        let relative: Vec<&Path> = paths
            .iter()
            .filter_map(|path| path.strip_prefix(&root).ok())
            .collect();
        if relative.iter().any(|rel| changes_rules(rel)) {
            self.rescan(backend);
            return;
        }
        let created = self.created_folders(backend, relative.into_iter());
        let visible = self.not_ignored(backend, created);
        self.walk(backend, visible);
    }

    /// What git ignores may have changed (a `.gitignore`), or git could not tell: every folder is
    /// looked at again and those now shown are added. A folder git now ignores stays watched
    /// until the repository is watched again; its changes are dropped by the filter.
    pub fn rescan(&mut self, backend: &dyn RepositoryBackend) {
        self.walk(backend, vec![PathBuf::new()]);
    }

    /// The folders among `paths` (relative) not watched yet. A path that is no longer a folder
    /// is forgotten with what was under it: its watches went with it, and one made again in its
    /// place is a new folder.
    fn created_folders<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        paths: impl Iterator<Item = &'a Path>,
    ) -> Vec<PathBuf> {
        let mut created = Vec::new();
        for rel in paths {
            let path = self.root.join(rel);
            let watched = self.watched.contains(&path);
            let folder = backend.folders(&self.root, rel).is_some();
            if watched && !folder {
                self.watched.retain(|watched| !watched.starts_with(&path));
            } else if folder && !watched {
                created.push(rel.to_path_buf());
            }
        }
        created
    }

    /// Watches `start` (folders relative to the root, not ignored by git) and the folders under
    /// them git does not ignore, one level at a time: git is asked once per level.
    fn walk(&mut self, backend: &dyn RepositoryBackend, start: Vec<PathBuf>) {
        let mut level = start;
        while !level.is_empty() {
            let mut children = Vec::new();
            for folder in level {
                if !self.add(&self.root.join(&folder)) {
                    return;
                }
                // a repository inside (a submodule, a clone) is not this one's files: git refuses
                // to answer about paths in a submodule
                let inner = !folder.as_os_str().is_empty()
                    && backend.has_entry(&self.root, &folder.join(".git"));
                if inner {
                    continue;
                }
                for name in backend.folders(&self.root, &folder).unwrap_or_default() {
                    if name != Path::new(".git") {
                        children.push(folder.join(name));
                    }
                }
            }
            level = self.not_ignored(backend, children);
        }
    }

    /// Watches `folder` (relative to `base`) and every folder under it, ignored or not.
    fn add_all(&mut self, backend: &dyn RepositoryBackend, base: &Path, folder: PathBuf) {
        let mut pending = vec![folder];
        while let Some(folder) = pending.pop() {
            let Some(names) = backend.folders(base, &folder) else {
                continue;
            };
            if !self.add(&base.join(&folder)) {
                return;
            }
            pending.extend(names.into_iter().map(|name| folder.join(name)));
        }
    }

    /// The folders (relative) git does not ignore. When git cannot answer, all of them: a folder
    /// watched for nothing costs less than a change missed.
    fn not_ignored(&self, backend: &dyn RepositoryBackend, folders: Vec<PathBuf>) -> Vec<PathBuf> {
        if folders.is_empty() {
            return folders;
        }
        let asked: BTreeSet<&Path> = folders.iter().map(PathBuf::as_path).collect();
        let Some(ignored) = check_ignore(backend, &self.root, &asked) else {
            return folders;
        };
        folders
            .into_iter()
            .filter(|folder| !ignored.contains(folder))
            .collect()
    }

    /// Watches `folder` (absolute) unless it is already; false once the system's limit is reached.
    fn add(&mut self, folder: &Path) -> bool {
        if self.full {
            return false;
        }
        if self.watched.contains(folder) {
            return true;
        }
        match self.watcher.add(folder) {
            FolderAdded::Watched => {
                self.watched.insert(folder.to_path_buf());
            }
            FolderAdded::Skipped => {}
            FolderAdded::Full => {
                self.full = true;
                tracing::warn!(
                    watched = self.watched.len(),
                    "the system's limit on watches is reached: the other folders are not watched"
                );
                return false;
            }
        }
        true
    }
}
