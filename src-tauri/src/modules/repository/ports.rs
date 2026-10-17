use std::io::Read;
use std::path::{Path, PathBuf};

pub(crate) struct GitOutput {
    /// -1 when git was killed: it wrote more than the call reads, or did not end in time.
    pub(crate) code: i32,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: String,
    /// git wrote more than `max_stdout` bytes: `stdout` is its first `max_stdout`, cut anywhere,
    /// and git was killed instead of read to the end.
    pub(crate) truncated: bool,
}

/// What the repository module needs from the machine: the `git` CLI and read access to files in
/// the working tree. Every git call is bounded: it reads at most `max_stdout` bytes of output,
/// and fails with `git_timed_out` when git takes too long, killed either way.
pub(crate) trait RepositoryBackend: Send + Sync {
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
}

/// A path of the working tree, as `read_entry` finds it.
pub(crate) enum WorktreeEntry {
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
