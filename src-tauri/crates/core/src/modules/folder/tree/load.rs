//! Reading a folder's tree: what git lists in a repository, or the walk of a folder without git.

use std::collections::HashSet;
use std::path::Path;

use super::FileTree;
use crate::modules::folder::contracts::RepositoryInfo;
use crate::modules::folder::open::existing_root;
use crate::modules::folder::ports::{git_checked, joined, nul_paths, RepositoryBackend};
use crate::modules::folder::reading::MAX_TREE_PATHS;

/// Output read from `git ls-files`, well past what `MAX_TREE_PATHS` paths take.
const MAX_LS_FILES_BYTES: usize = 32 * 1024 * 1024;

/// The paths of a NUL-separated list, without the last when the list was cut in it.
fn listed(bytes: &[u8], truncated: bool) -> Vec<String> {
    let mut paths: Vec<String> = nul_paths(bytes).collect();
    if truncated {
        paths.pop();
    }
    paths
}

/// Reads the files git lists: tracked and untracked ones not ignored, as `git status` sees them,
/// without the tracked files deleted from disk; and what git ignores, at the top of what it
/// ignores (`--directory`: an ignored folder's files are not listed). The three in parallel.
pub fn load_file_tree(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<FileTree> {
    let root = existing_root(backend, repository)?;
    let ls_files = |args: &[&str]| ls_files(backend, root, args);
    let (all, deleted, ignored) = std::thread::scope(|scope| {
        let deleted = scope.spawn(|| ls_files(&["ls-files", "-z", "--deleted"]));
        let ignored = scope.spawn(|| {
            ls_files(&[
                "ls-files",
                "-z",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
            ])
        });
        let all = ls_files(&[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ]);
        (all, joined(deleted), joined(ignored))
    });
    let (paths, cut) = all?;
    let (deleted, _) = deleted?;
    // a list cut short still names what it holds: the rest is not shown
    let (ignored, _) = ignored?;
    let deleted: HashSet<&str> = deleted.iter().map(String::as_str).collect();
    let mut present = paths
        .iter()
        .map(String::as_str)
        .filter(|path| !deleted.contains(path));
    let tree = FileTree::new(
        present.by_ref().take(MAX_TREE_PATHS),
        ignored.iter().map(String::as_str).take(MAX_TREE_PATHS),
    );
    Ok(tree.with_truncated(cut || present.next().is_some()))
}

/// The paths `git ls-files` with `args` lists, and whether the list was cut.
fn ls_files(
    backend: &dyn RepositoryBackend,
    root: &Path,
    args: &[&str],
) -> anyhow::Result<(Vec<String>, bool)> {
    let out = git_checked(backend, root, args, &[0], MAX_LS_FILES_BYTES)?;
    Ok((listed(&out.stdout, out.truncated), out.truncated))
}

/// The files of a folder without git, as the Files panel shows them: at most `MAX_TREE_PATHS`,
/// past them the tree says it stops.
pub fn load_folder_tree(backend: &dyn RepositoryBackend, root: &Path) -> FileTree {
    let walked = backend.walk(root, MAX_TREE_PATHS);
    FileTree::new(
        walked.paths.iter().map(String::as_str),
        walked.ignored.iter().map(String::as_str),
    )
    .with_truncated(walked.truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cut_list_drops_its_last_path() {
        assert_eq!(listed(b"a\0b\0c", true), ["a", "b"]);
        assert_eq!(listed(b"a\0b\0", false), ["a", "b"]);
    }
}
