use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::contracts::{
    ChangeArea, ChangeKind, ChangeTotals, ChangedFile, RepositoryInfo, RepositorySnapshot,
    RepositorySummary,
};
use super::limits::{MAX_CHANGED_PATHS, MAX_NUMSTAT_BYTES};
use super::numstat::{count_text_lines, parse_numstat_z, Counts, LineCounts};
use super::open::existing_root;
use super::ports::{git_checked, joined, RepositoryBackend};
use super::status::{parse_porcelain_v2, StatusEntry, StatusReport};

/// Untracked files are read to count their lines, within these limits per snapshot. Past them a
/// file gets no count: reading thousands of generated files on every refresh would cost more than
/// the counts are worth.
const MAX_UNTRACKED_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_UNTRACKED_FILES_READ: usize = 2_000;

/// Output read from `git status`, well past what `MAX_CHANGED_PATHS` paths take (about 150 bytes
/// each), so that git is killed rather than read to the end when the paths are many more.
const MAX_STATUS_BYTES: usize = 8 * 1024 * 1024;

type CountsByPath = HashMap<String, Counts>;

fn by_path(counts: Vec<LineCounts>) -> CountsByPath {
    counts.into_iter().map(|c| (c.path, c.counts)).collect()
}

/// The counts of two areas of the same paths, added up path by path.
fn added_up(first: Numstat, second: Numstat) -> Numstat {
    let mut counts = first.counts;
    for (path, more) in second.counts {
        let sum = counts.entry(path).or_default();
        *sum = Counts {
            additions: add_options(sum.additions, more.additions),
            deletions: add_options(sum.deletions, more.deletions),
            binary: sum.binary || more.binary,
        };
    }
    Numstat {
        counts,
        truncated: first.truncated || second.truncated,
    }
}

fn add_options(a: Option<u32>, b: Option<u32>) -> Option<u32> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0).saturating_add(b.unwrap_or(0))),
    }
}

/// `git status`, with at most `MAX_CHANGED_PATHS` entries.
fn status(backend: &dyn RepositoryBackend, root: &Path) -> anyhow::Result<StatusReport> {
    let out = git_checked(
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
        MAX_STATUS_BYTES,
    )?;
    let mut report = parse_porcelain_v2(&out.stdout);
    if out.truncated {
        // the output was cut anywhere, maybe in the last entry
        report.entries.pop();
    }
    report.truncated = out.truncated || report.entries.len() > MAX_CHANGED_PATHS;
    report.entries.truncate(MAX_CHANGED_PATHS);
    Ok(report)
}

/// The line counts of one numstat, by path.
struct Numstat {
    counts: CountsByPath,
    /// The output was cut: some paths have no counts.
    truncated: bool,
}

fn numstat(
    backend: &dyn RepositoryBackend,
    root: &Path,
    extra: &[&str],
) -> anyhow::Result<Numstat> {
    let mut args = vec!["diff", "--numstat", "-z", "--no-ext-diff"];
    args.extend_from_slice(extra);
    let out = git_checked(backend, root, &args, &[0], MAX_NUMSTAT_BYTES)?;
    let mut counts = parse_numstat_z(&out.stdout);
    if out.truncated {
        // the output was cut anywhere, maybe in the last record
        counts.pop();
    }
    Ok(Numstat {
        counts: by_path(counts),
        truncated: out.truncated,
    })
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

/// The summary of `status`, where `tracked` holds the line counts of tracked paths against HEAD.
/// New files are counted as files, their lines unread.
fn summarize(status: &StatusReport, tracked: &Numstat) -> RepositorySummary {
    let (additions, deletions) = sum(tracked.counts.values().copied());
    let paths: HashSet<&str> = status.entries.iter().map(|e| e.path.as_str()).collect();
    RepositorySummary {
        branch: status.branch.clone(),
        totals: ChangeTotals {
            files: u32::try_from(paths.len()).unwrap_or(u32::MAX),
            additions,
            deletions,
        },
        truncated: status.truncated || tracked.truncated,
    }
}

/// Branch, changed files with their counts per area, and the summary of the open repository.
pub fn load_snapshot(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<RepositorySnapshot> {
    let root = existing_root(backend, repository)?;
    // The four commands are independent, so they run together and the snapshot costs about as
    // much as the slowest one. The diff against HEAD fails before the first commit; its result
    // is only used when status reports a commit.
    let (status, unstaged, staged, against_head) = std::thread::scope(|scope| {
        let unstaged = scope.spawn(|| numstat(backend, root, &[]));
        let staged = scope.spawn(|| numstat(backend, root, &["--cached"]));
        let against_head = scope.spawn(|| numstat(backend, root, &["HEAD"]));
        let status = status(backend, root);
        (
            status,
            joined(unstaged),
            joined(staged),
            joined(against_head),
        )
    });
    let status = status?;
    let unstaged = unstaged?;
    let staged = staged?;

    let mut files = Vec::new();
    let mut budget = UntrackedBudget::new();
    for entry in &status.entries {
        if let Some(kind) = entry.staged {
            let counts = staged.counts.get(&entry.path).copied().unwrap_or_default();
            files.push(changed_file(entry, ChangeArea::Staged, kind, counts));
        }
        match entry.unstaged {
            Some(ChangeKind::Untracked) => {
                let counts = budget.count(backend, &root.join(&entry.path));
                files.push(changed_file(
                    entry,
                    ChangeArea::Untracked,
                    ChangeKind::Untracked,
                    counts,
                ));
            }
            Some(kind) => {
                let counts = unstaged
                    .counts
                    .get(&entry.path)
                    .copied()
                    .unwrap_or_default();
                files.push(changed_file(entry, ChangeArea::Unstaged, kind, counts));
            }
            None => {}
        }
    }

    // Against HEAD a line edited, staged, then edited again counts once. Before the first commit
    // there is no HEAD, and the staged and unstaged counts are added up instead.
    let tracked = if status.branch.commit.is_some() {
        against_head?
    } else {
        added_up(staged, unstaged)
    };

    Ok(RepositorySnapshot {
        files,
        summary: summarize(&status, &tracked),
    })
}

/// The summary alone, for a project shown only as its card or its avatar: `git status` and the
/// numstat against HEAD, run together; no new file is read.
pub fn load_summary(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<RepositorySummary> {
    let root = existing_root(backend, repository)?;
    let (status, against_head) = std::thread::scope(|scope| {
        let against_head = scope.spawn(|| numstat(backend, root, &["HEAD"]));
        (status(backend, root), joined(against_head))
    });
    let status = status?;
    let tracked = if status.branch.commit.is_some() {
        against_head?
    } else {
        // before the first commit (rare): what is staged plus what is not, one after the other
        added_up(
            numstat(backend, root, &["--cached"])?,
            numstat(backend, root, &[])?,
        )
    };
    Ok(summarize(&status, &tracked))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::repository::{GitOutput, WorktreeEntry};

    /// Files of `size` bytes of text, one line each, except `logo.png` which is binary.
    struct FakeFiles {
        size: usize,
    }

    impl RepositoryBackend for FakeFiles {
        fn is_dir(&self, _path: &Path) -> bool {
            unreachable!()
        }

        fn has_entry(&self, _root: &Path, _path: &Path) -> bool {
            unreachable!()
        }

        fn git(&self, _cwd: &Path, _args: &[&str], _max: usize) -> anyhow::Result<GitOutput> {
            unreachable!()
        }

        fn git_with_input(
            &self,
            _cwd: &Path,
            _args: &[&str],
            _input: &[u8],
            _max: usize,
        ) -> anyhow::Result<GitOutput> {
            unreachable!()
        }

        fn read_entry(&self, _root: &Path, _path: &Path, _limit: usize) -> Option<WorktreeEntry> {
            unreachable!()
        }

        fn open_file(&self, _root: &Path, _path: &Path) -> Option<Box<dyn std::io::Read + Send>> {
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

    /// `git status` printing `stdout`, cut by the transport when `truncated`.
    struct FakeStatus {
        stdout: Vec<u8>,
        truncated: bool,
    }

    impl RepositoryBackend for FakeStatus {
        fn is_dir(&self, _path: &Path) -> bool {
            unreachable!()
        }

        fn has_entry(&self, _root: &Path, _path: &Path) -> bool {
            unreachable!()
        }

        fn git(&self, _cwd: &Path, _args: &[&str], _max: usize) -> anyhow::Result<GitOutput> {
            Ok(GitOutput {
                code: if self.truncated { -1 } else { 0 },
                stdout: self.stdout.clone(),
                stderr: String::new(),
                truncated: self.truncated,
            })
        }

        fn git_with_input(
            &self,
            _cwd: &Path,
            _args: &[&str],
            _input: &[u8],
            _max: usize,
        ) -> anyhow::Result<GitOutput> {
            unreachable!()
        }

        fn read_entry(&self, _root: &Path, _path: &Path, _limit: usize) -> Option<WorktreeEntry> {
            unreachable!()
        }

        fn open_file(&self, _root: &Path, _path: &Path) -> Option<Box<dyn std::io::Read + Send>> {
            unreachable!()
        }

        fn read_file(&self, _path: &Path, _limit: u64) -> Option<Vec<u8>> {
            unreachable!()
        }
    }

    fn untracked(count: usize) -> Vec<u8> {
        let mut stdout = b"# branch.head main\0".to_vec();
        for i in 0..count {
            stdout.extend_from_slice(format!("? node_modules/{i}.js\0").as_bytes());
        }
        stdout
    }

    #[test]
    fn status_lists_at_most_the_limit_of_changed_paths() {
        let within = FakeStatus {
            stdout: untracked(MAX_CHANGED_PATHS),
            truncated: false,
        };
        let report = status(&within, Path::new(".")).unwrap();
        assert_eq!(report.entries.len(), MAX_CHANGED_PATHS);
        assert!(!report.truncated);

        let past = FakeStatus {
            stdout: untracked(MAX_CHANGED_PATHS + 1),
            truncated: false,
        };
        let report = status(&past, Path::new(".")).unwrap();
        assert_eq!(report.entries.len(), MAX_CHANGED_PATHS);
        assert!(report.truncated);
        assert_eq!(report.branch.head.as_deref(), Some("main"));
    }

    #[test]
    fn status_cut_by_the_transport_drops_its_last_entry() {
        let mut stdout = untracked(2);
        stdout.extend_from_slice(b"? node_modules/cut-in-the-mi");
        let report = status(
            &FakeStatus {
                stdout,
                truncated: true,
            },
            Path::new("."),
        )
        .unwrap();
        let paths: Vec<&str> = report.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["node_modules/0.js", "node_modules/1.js"]);
        assert!(report.truncated);
    }

    #[test]
    fn counts_of_two_areas_add_up_path_by_path() {
        let numstat = |entries: &[(&str, Counts)], truncated| Numstat {
            counts: entries.iter().map(|(p, c)| (p.to_string(), *c)).collect(),
            truncated,
        };
        let sum = added_up(
            numstat(
                &[("a.ts", Counts::lines(1, 2)), ("logo.png", Counts::BINARY)],
                false,
            ),
            numstat(
                &[("a.ts", Counts::lines(3, 0)), ("b.ts", Counts::lines(0, 1))],
                true,
            ),
        );
        assert_eq!(sum.counts["a.ts"], Counts::lines(4, 2));
        assert_eq!(sum.counts["b.ts"], Counts::lines(0, 1));
        assert_eq!(sum.counts["logo.png"], Counts::BINARY);
        assert!(sum.truncated);
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
