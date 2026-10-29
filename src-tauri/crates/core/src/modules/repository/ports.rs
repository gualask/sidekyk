use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::contracts::FileStamp;
use crate::shared::process::ProcessOutput;

/// What a git call wrote, and how it ended.
pub type GitOutput = ProcessOutput;

/// What the repository and folder modules need from the machine: the `git` CLI and read access to
/// the files of a project's folder. The modules never read the disk themselves, so the machine can be another one
/// (a WSL distro). Every git call is bounded: it reads at most `max_stdout` bytes of output, and
/// fails with `git_timed_out` when git takes too long, killed either way.
pub trait RepositoryBackend: Send + Sync {
    /// Runs `git` in `cwd` and returns its output whatever the exit code.
    fn git(&self, cwd: &Path, args: &[&str], max_stdout: usize) -> anyhow::Result<GitOutput>;

    /// Like `git`, with `input` written to its standard input.
    fn git_with_input(
        &self,
        cwd: &Path,
        args: &[&str],
        input: &[u8],
        max_stdout: usize,
    ) -> anyhow::Result<GitOutput>;

    /// Reads a working-tree file, or `None` when it is missing or larger than `limit` bytes.
    fn read_file(&self, path: &Path, limit: u64) -> Option<Vec<u8>>;

    /// What is at `path` (relative) under `root`, without following a link, or `None` when
    /// nothing is there or a folder on the way is a link: a file's first `limit` bytes, a link's
    /// target, or a folder (a submodule).
    fn read_entry(&self, root: &Path, path: &Path, limit: usize) -> Option<WorktreeEntry>;

    /// The size and last change of the file at `path` (relative) under `root`, or `None` when it
    /// is not a file there: missing, a link (never followed), a folder, or behind a link.
    fn file_stamp(&self, root: &Path, path: &Path) -> Option<FileStamp>;

    /// The file at `path` (relative) under `root`, to read as a stream, or `None` when it is not a
    /// file there: missing, a link (never followed), a folder, or behind a folder that is a link.
    fn open_file(&self, root: &Path, path: &Path) -> Option<Box<dyn Read + Send>>;

    /// Whether `path` is a folder, following links.
    fn is_dir(&self, path: &Path) -> bool;

    /// Whether anything is at `path` (relative) under `root`, a link there not followed.
    fn has_entry(&self, root: &Path, path: &Path) -> bool;

    /// The names of the folders in `path` (relative) under `root`, links not followed; `None`
    /// when `path` is not a folder there.
    fn folders(&self, root: &Path, path: &Path) -> Option<Vec<PathBuf>>;

    /// The files of a folder without git, at most `max`: what its `.gitignore` and `.ignore` files,
    /// git's global excludes and `folder::always_hidden` do not hide; links listed, not followed.
    fn walk(&self, root: &Path, max: usize) -> Walked;

    /// The rules `walk` hides files by, asked about one path at a time.
    fn folder_rules(&self, root: &Path) -> Box<dyn FolderRules>;

    /// `path` as the watcher reports what is under it, or `None` when nothing is there: links
    /// resolved where the system's watcher reports real paths (FSEvents, inotify), as git names a
    /// repository's root; on Windows the absolute path as given.
    fn real_path(&self, path: &Path) -> Option<PathBuf>;
}

/// What `walk` would not list, for one path at a time (a change the watcher saw). Each folder's
/// ignore files are read once, when a path under it is first asked about: after one changes,
/// rules are asked for again.
pub trait FolderRules: Send {
    /// Whether `path` (relative to the root) is hidden: itself, or a folder above it. What is
    /// there tells a folder from a file; a path gone is a file.
    fn is_hidden(&mut self, path: &Path) -> bool;

    /// Whether `path` (relative to the root) is a file the rules are read from: a change to it
    /// changes them.
    fn is_rules_file(&self, path: &Path) -> bool;
}

/// What `walk` found.
pub struct Walked {
    /// Relative to the root, `/` between names, in no order.
    pub paths: Vec<String>,
    /// More files were there than the walk took.
    pub truncated: bool,
}

/// What a watcher saw.
#[derive(Debug, PartialEq)]
pub enum Changed {
    /// These paths (absolute) changed during a quiet period.
    Paths(Vec<PathBuf>),
    /// The system dropped events, its queue full: any path may have changed.
    Unknown,
}

/// Watches a project's folder, and a repository's git dir.
pub trait RepositoryWatcher: Send + Sync {
    /// Calls `on_change` with what changed, until the returned watch is dropped. `classify` says
    /// which paths matter. `git_dir` is `None` for a folder without git.
    fn watch(
        &self,
        root: &Path,
        git_dir: Option<&Path>,
        on_change: Box<dyn FnMut(Changed) + Send>,
    ) -> anyhow::Result<Watch>;
}

/// A project's folder being watched: watching stops when `guard` is dropped.
pub struct Watch {
    pub guard: Box<dyn Send>,
    /// `Some` where the system watches one folder at a time (inotify): nothing is watched until
    /// folders are added through it. `None` where the folder and its git dir are watched with all
    /// they hold (FSEvents, `ReadDirectoryChangesW`).
    pub folders: Option<Arc<dyn FolderWatcher>>,
}

/// Adds folders to a watch that covers one folder at a time.
pub trait FolderWatcher: Send + Sync {
    /// Watches the entries of `folder` (absolute), not those of its subfolders.
    fn add(&self, folder: &Path) -> FolderAdded;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FolderAdded {
    Watched,
    /// Gone meanwhile, or not readable.
    Skipped,
    /// The system's limit on watches is reached: no more folders can be watched.
    Full,
}

/// A path of the working tree, as `read_entry` finds it.
pub enum WorktreeEntry {
    File {
        head: Vec<u8>,
        /// The file is longer than `head`.
        truncated: bool,
    },
    Link(PathBuf),
    Folder,
}

/// Runs `git` and fails unless it exits with one of `ok_codes`. Output cut at `max_stdout` comes
/// back as it is, `truncated`: git was killed, so its exit code says nothing.
pub(super) fn git_checked(
    backend: &dyn RepositoryBackend,
    cwd: &Path,
    args: &[&str],
    ok_codes: &[i32],
    max_stdout: usize,
) -> anyhow::Result<GitOutput> {
    let out = backend.git(cwd, args, max_stdout)?;
    if out.truncated || ok_codes.contains(&out.code) {
        return Ok(out);
    }
    let detail = out.stderr.trim();
    anyhow::bail!(
        "git {} exited with code {}{}{}",
        args.first().unwrap_or(&""),
        out.code,
        if detail.is_empty() { "" } else { ": " },
        detail
    )
}

/// The result of git run on a thread of its own, or a failure if the thread panicked.
pub(super) fn joined<T>(
    handle: std::thread::ScopedJoinHandle<'_, anyhow::Result<T>>,
) -> anyhow::Result<T> {
    handle
        .join()
        .unwrap_or_else(|_| Err(anyhow::anyhow!("git thread panicked")))
}
