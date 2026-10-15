//! How much git output the repository module reads, shared by the snapshot, the diffs and the
//! recent commits. Past a limit git is killed instead of read to the end (see `ports.rs`).

/// At most this many changed paths are listed, of the working tree or of a commit, as VS Code's
/// `git.statusLimit`: past it, an unignored `node_modules` or build folder would fill the list and
/// the payload for nothing.
pub(super) const MAX_CHANGED_PATHS: usize = 10_000;

/// Output read from a numstat, well past what `MAX_CHANGED_PATHS` paths take.
pub(super) const MAX_NUMSTAT_BYTES: usize = 4 * 1024 * 1024;

/// Larger diffs are cut at the last whole line before this size.
pub(super) const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
