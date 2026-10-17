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

/// The Files panel shows at most this many files of a repository: past them (an unignored
/// `node_modules` of hundreds of thousands), the tree stops there.
pub(super) const MAX_TREE_PATHS: usize = 200_000;

/// The Files panel shows a file's first 2 MiB, cut at the last whole line, as a diff is.
pub(crate) const MAX_FILE_BYTES: usize = MAX_DIFF_BYTES;
