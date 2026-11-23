use std::path::{Path, PathBuf};

use super::ignored::{Sorted, Visible};
use crate::modules::folder::ports::{FolderRules, RepositoryBackend};

/// Which changes the watcher saw in a folder without git show: those its walk would list, by the
/// same rules. No git runs, so the answer is the same while the window is hidden.
pub struct FolderChanges {
    /// As the watcher names it.
    root: PathBuf,
    rules: Box<dyn FolderRules>,
}

impl FolderChanges {
    pub fn new(backend: &dyn RepositoryBackend, root: PathBuf) -> Self {
        let rules = backend.folder_rules(&root);
        Self { root, rules }
    }

    /// Which of these changed paths (absolute) show, and which the rules hide. Every change
    /// counts when one may change what shows: an ignore file (its rules are read again), the root
    /// itself, a path outside.
    pub fn sort<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        changed: &'a [PathBuf],
    ) -> Sorted<'a> {
        let mut shown: Vec<&Path> = Vec::new();
        let mut hidden: Vec<&Path> = Vec::new();
        for path in changed {
            let Ok(rel) = path.strip_prefix(&self.root) else {
                return Sorted::unknown();
            };
            if rel.as_os_str().is_empty() {
                return Sorted::unknown();
            }
            if self.rules.is_rules_file(rel) {
                self.rules = backend.folder_rules(&self.root);
                return Sorted::unknown();
            }
            if self.rules.is_hidden(rel) {
                hidden.push(rel);
            } else {
                shown.push(rel);
            }
        }
        Sorted {
            visible: Visible::Paths(shown),
            ignored: hidden,
        }
    }
}
