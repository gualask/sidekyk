use std::io::Read;
use std::path::{Path, PathBuf};

use crate::shared::process::ProcessOutput;

/// What a git call wrote, and how it ended.
pub type GitOutput = ProcessOutput;

/// What the repository module needs from the machine: the `git` CLI and read access to files in
/// the working tree. The module never reads the disk itself, so the machine can be another one
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

    /// The file at `path` (relative) under `root`, to read as a stream, or `None` when it is not a
    /// file there: missing, a link (never followed), a folder, or behind a folder that is a link.
    fn open_file(&self, root: &Path, path: &Path) -> Option<Box<dyn Read + Send>>;

    /// Whether `path` is a folder, following links.
    fn is_dir(&self, path: &Path) -> bool;

    /// Whether anything is at `path` (relative) under `root`, a link there not followed.
    fn has_entry(&self, root: &Path, path: &Path) -> bool;
}

/// Watches a repository's working tree and git dir.
pub trait RepositoryWatcher: Send + Sync {
    /// Calls `on_change` with the paths (absolute) that changed during each quiet period, until
    /// the returned watch is dropped. `classify` says which of them matter.
    fn watch(
        &self,
        root: &Path,
        git_dir: &Path,
        on_change: Box<dyn FnMut(Vec<PathBuf>) + Send>,
    ) -> anyhow::Result<Watch>;
}

/// A repository being watched: watching stops when it is dropped.
pub type Watch = Box<dyn Send>;

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
