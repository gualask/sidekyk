//! The lines of untracked files, read to count them within a budget per snapshot.

use std::path::Path;

use crate::modules::folder::RepositoryBackend;
use crate::modules::repository::numstat::{count_text_lines, Counts};

/// Untracked files are read to count their lines, within these limits per snapshot. Past them a
/// file gets no count: reading thousands of generated files on every refresh would cost more than
/// the counts are worth.
const MAX_UNTRACKED_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_UNTRACKED_FILES_READ: usize = 2_000;

/// What is left of the untracked reading limits during one snapshot.
pub(super) struct UntrackedBudget {
    files: usize,
    bytes: u64,
}

impl UntrackedBudget {
    pub(super) fn new() -> Self {
        Self {
            files: MAX_UNTRACKED_FILES_READ,
            bytes: MAX_UNTRACKED_TOTAL_BYTES,
        }
    }

    pub(super) fn count(&mut self, backend: &dyn RepositoryBackend, path: &Path) -> Counts {
        if self.files == 0 || self.bytes == 0 {
            return Counts::default();
        }
        self.files -= 1;
        let limit = MAX_UNTRACKED_FILE_BYTES.min(self.bytes);
        let Some(bytes) = backend.read_file(path, limit) else {
            return Counts::default();
        };
        self.bytes = self.bytes.saturating_sub(bytes.len() as u64);
        count_text_lines(&bytes).map_or(Counts::BINARY, |added| Counts::lines(added, 0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::folder::FakeBackend;

    /// Files of `size` bytes of text, one line each, except `logo.png` which is binary.
    struct FakeFiles {
        size: usize,
    }

    impl FakeBackend for FakeFiles {
        fn read_file(&self, path: &Path, limit: u64) -> Option<Vec<u8>> {
            if self.size as u64 > limit {
                return None;
            }
            let mut bytes = vec![b'a'; self.size];
            if path.ends_with("logo.png") {
                bytes[0] = 0;
            }
            Some(bytes)
        }
    }

    #[test]
    fn untracked_files_are_counted_until_the_budget_runs_out() {
        let backend = FakeFiles { size: 1024 };
        let mut budget = UntrackedBudget::new();
        assert_eq!(
            budget.count(&backend, Path::new("a.ts")),
            Counts::lines(1, 0)
        );
        assert_eq!(
            budget.count(&backend, Path::new("logo.png")),
            Counts::BINARY
        );

        for _ in 2..MAX_UNTRACKED_FILES_READ {
            budget.count(&backend, Path::new("a.ts"));
        }
        assert_eq!(
            budget.count(&backend, Path::new("a.ts")),
            Counts::default(),
            "past the file limit, not counted and not binary"
        );
    }

    #[test]
    fn large_files_are_not_counted_and_use_up_no_budget() {
        let huge = FakeFiles {
            size: MAX_UNTRACKED_FILE_BYTES as usize + 1,
        };
        let mut budget = UntrackedBudget::new();
        assert_eq!(
            budget.count(&huge, Path::new("dump.sql")),
            Counts::default()
        );
        assert_eq!(budget.bytes, MAX_UNTRACKED_TOTAL_BYTES);

        let big = FakeFiles {
            size: MAX_UNTRACKED_FILE_BYTES as usize,
        };
        let fit = (MAX_UNTRACKED_TOTAL_BYTES / MAX_UNTRACKED_FILE_BYTES) as usize;
        for _ in 0..fit {
            assert_eq!(budget.count(&big, Path::new("a.ts")), Counts::lines(1, 0));
        }
        assert_eq!(budget.count(&big, Path::new("a.ts")), Counts::default());
    }
}
