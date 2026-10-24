use std::path::Path;

use crate::modules::repository::{FileTree, RepositoryBackend, MAX_TREE_PATHS};

/// The files of a folder without git, as the Files panel shows them: at most `MAX_TREE_PATHS`,
/// past them the tree says it stops.
pub fn load_folder_tree(backend: &dyn RepositoryBackend, root: &Path) -> FileTree {
    let walked = backend.walk(root, MAX_TREE_PATHS);
    FileTree::from_paths(walked.paths.iter().map(String::as_str)).with_truncated(walked.truncated)
}
