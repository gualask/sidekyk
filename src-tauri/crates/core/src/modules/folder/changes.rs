use std::path::{Path, PathBuf};

use crate::modules::repository::{FolderRules, RepositoryBackend, Visible};

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

    /// Which of these changed paths (absolute) show. Every change counts when one may change
    /// what shows: an ignore file (its rules are read again), the root itself, a path outside.
    pub fn visible<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        changed: &'a [PathBuf],
    ) -> Visible<'a> {
        let mut shown: Vec<&Path> = Vec::new();
        for path in changed {
            let Ok(rel) = path.strip_prefix(&self.root) else {
                return Visible::Unknown;
            };
            if rel.as_os_str().is_empty() {
                return Visible::Unknown;
            }
            if self.rules.is_rules_file(rel) {
                self.rules = backend.folder_rules(&self.root);
                return Visible::Unknown;
            }
            if !self.rules.is_hidden(rel) {
                shown.push(rel);
            }
        }
        Visible::Paths(shown)
    }
}
