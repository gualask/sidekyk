use std::path::Path;

pub(crate) struct GitOutput {
    pub(crate) code: i32,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: String,
}

/// What the repository module needs from the machine: the `git` CLI and read access to files in
/// the working tree.
pub(crate) trait RepositoryBackend: Send + Sync {
    /// Runs `git` in `cwd` and returns its output whatever the exit code.
    fn git(&self, cwd: &Path, args: &[&str]) -> anyhow::Result<GitOutput>;

    /// Reads a working-tree file, or `None` when it is missing or larger than `limit` bytes.
    fn read_file(&self, path: &Path, limit: u64) -> Option<Vec<u8>>;
}

/// Runs `git` and fails unless it exits with one of `ok_codes`.
pub(super) fn git_checked(
    backend: &dyn RepositoryBackend,
    cwd: &Path,
    args: &[&str],
    ok_codes: &[i32],
) -> anyhow::Result<Vec<u8>> {
    let out = backend.git(cwd, args)?;
    if ok_codes.contains(&out.code) {
        return Ok(out.stdout);
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
