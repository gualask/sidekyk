use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::contracts::{
    ChangeArea, ChangeKind, ChangeTotals, ChangedFile, RepositoryInfo, RepositorySnapshot,
};
use super::numstat::{count_text_lines, parse_numstat_z, Counts, LineCounts};
use super::open::existing_root;
use super::ports::{git_checked, RepositoryBackend};
use super::status::{parse_porcelain_v2, StatusEntry};

/// Untracked files are read to count their lines, within these limits per snapshot. Past them a
/// file gets no count: reading thousands of generated files on every refresh would cost more than
/// the counts are worth.
const MAX_UNTRACKED_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_UNTRACKED_FILES_READ: usize = 2_000;

type CountsByPath = HashMap<String, Counts>;

fn by_path(counts: Vec<LineCounts>) -> CountsByPath {
    counts.into_iter().map(|c| (c.path, c.counts)).collect()
}

fn numstat(
    backend: &dyn RepositoryBackend,
    root: &Path,
    extra: &[&str],
) -> anyhow::Result<Vec<LineCounts>> {
    let mut args = vec!["diff", "--numstat", "-z", "--no-ext-diff"];
    args.extend_from_slice(extra);
    Ok(parse_numstat_z(&git_checked(backend, root, &args, &[0])?))
}

/// What is left of the untracked reading limits during one snapshot.
struct UntrackedBudget {
    files: usize,
    bytes: u64,
}

impl UntrackedBudget {
    fn new() -> Self {
        Self {
            files: MAX_UNTRACKED_FILES_READ,
            bytes: MAX_UNTRACKED_TOTAL_BYTES,
        }
    }

    fn count(&mut self, backend: &dyn RepositoryBackend, path: &Path) -> Counts {
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

fn changed_file(
    entry: &StatusEntry,
    area: ChangeArea,
    kind: ChangeKind,
    counts: Counts,
) -> ChangedFile {
    ChangedFile {
        path: entry.path.clone(),
        orig_path: entry.orig_path.clone(),
        area,
        kind,
        additions: counts.additions,
        deletions: counts.deletions,
        binary: counts.binary,
    }
}

fn sum(counts: impl Iterator<Item = Counts>) -> (u32, u32) {
    counts.fold((0, 0), |(a, d), counts| {
        (
            a.saturating_add(counts.additions.unwrap_or(0)),
            d.saturating_add(counts.deletions.unwrap_or(0)),
        )
    })
}

/// Branch, changed files and totals for the open repository.
pub(crate) fn load_snapshot(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<RepositorySnapshot> {
    let root = existing_root(repository)?;
    // The four commands are independent, so they run together and the snapshot costs about as
    // much as the slowest one. The diff against HEAD fails before the first commit; its result
    // is only used when status reports a commit.
    let (status, unstaged, staged, against_head) = std::thread::scope(|scope| {
        let unstaged = scope.spawn(|| numstat(backend, root, &[]));
        let staged = scope.spawn(|| numstat(backend, root, &["--cached"]));
        let against_head = scope.spawn(|| numstat(backend, root, &["HEAD"]));
        let status = git_checked(
            backend,
            root,
            &[
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
            &[0],
        );
        let join = |handle: std::thread::ScopedJoinHandle<'_, _>| {
            handle
                .join()
                .unwrap_or_else(|_| Err(anyhow::anyhow!("git thread panicked")))
        };
        (status, join(unstaged), join(staged), join(against_head))
    });
    let status = parse_porcelain_v2(&status?);
    let unstaged = by_path(unstaged?);
    let staged = by_path(staged?);

    let mut files = Vec::new();
    let mut untracked_counts = Vec::new();
    let mut budget = UntrackedBudget::new();
    for entry in &status.entries {
        if let Some(kind) = entry.staged {
            let counts = staged.get(&entry.path).copied().unwrap_or_default();
            files.push(changed_file(entry, ChangeArea::Staged, kind, counts));
        }
        match entry.unstaged {
            Some(ChangeKind::Untracked) => {
                let counts = budget.count(backend, &root.join(&entry.path));
                untracked_counts.push(counts);
                files.push(changed_file(
                    entry,
                    ChangeArea::Untracked,
                    ChangeKind::Untracked,
                    counts,
                ));
            }
            Some(kind) => {
                let counts = unstaged.get(&entry.path).copied().unwrap_or_default();
                files.push(changed_file(entry, ChangeArea::Unstaged, kind, counts));
            }
            None => {}
        }
    }

    // Against HEAD a line edited, staged, then edited again counts once. Before the first commit
    // there is no HEAD, and the staged and unstaged counts are added up instead.
    let tracked = if status.branch.commit.is_some() {
        sum(by_path(against_head?).into_values())
    } else {
        sum(staged.into_values().chain(unstaged.into_values()))
    };
    let untracked = sum(untracked_counts.into_iter());
    let paths: HashSet<&str> = status.entries.iter().map(|e| e.path.as_str()).collect();

    Ok(RepositorySnapshot {
        repository: repository.clone(),
        branch: status.branch,
        totals: ChangeTotals {
            files: u32::try_from(paths.len()).unwrap_or(u32::MAX),
            additions: tracked.0.saturating_add(untracked.0),
            deletions: tracked.1.saturating_add(untracked.1),
        },
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::repository::GitOutput;

    /// Files of `size` bytes of text, one line each, except `logo.png` which is binary.
    struct FakeFiles {
        size: usize,
    }

    impl RepositoryBackend for FakeFiles {
        fn git(&self, _cwd: &Path, _args: &[&str]) -> anyhow::Result<GitOutput> {
            unreachable!()
        }

        fn git_with_input(
            &self,
            _cwd: &Path,
            _args: &[&str],
            _input: &[u8],
        ) -> anyhow::Result<GitOutput> {
            unreachable!()
        }

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
