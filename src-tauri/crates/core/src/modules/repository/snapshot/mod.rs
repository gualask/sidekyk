//! The snapshot of the open repository: `git status`, its changed files with their counts per
//! area, and the summary; the summary alone for a project shown only as its row.

mod staged;
mod untracked;

use std::collections::HashSet;
use std::path::Path;

use super::contracts::{
    ChangeArea, ChangeKind, ChangeTotals, ChangedFile, RepositorySnapshot, RepositorySummary,
};
use super::diff_counts::{added_up, numstat, Numstat};
use super::limits::MAX_CHANGED_PATHS;
use super::numstat::Counts;
use super::status::{parse_porcelain_v2, StatusEntry, StatusReport};
use crate::modules::folder::{
    existing_root, git_checked, joined, RepositoryBackend, RepositoryInfo,
};
use staged::{against_head, staged_area};
use untracked::UntrackedBudget;

/// Output read from `git status`, well past what `MAX_CHANGED_PATHS` paths take (about 150 bytes
/// each), so that git is killed rather than read to the end when the paths are many more.
const MAX_STATUS_BYTES: usize = 8 * 1024 * 1024;

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
    // The reads are independent, so they run together and the snapshot costs about as much as
    // the slowest one. The counts against HEAD are the unstaged ones but for the staged paths,
    // diffed against HEAD on their own (`against_head`): a numstat against HEAD of every path
    // would repeat the unstaged one, its whole cost, while nothing is staged.
    let (status, unstaged, staged) = std::thread::scope(|scope| {
        let unstaged = scope.spawn(|| numstat(backend, root, &[]));
        let staged = scope.spawn(|| staged_area(backend, root));
        let status = status(backend, root);
        (status, joined(unstaged), joined(staged))
    });
    let status = status?;
    let unstaged = unstaged?;
    let (staged, of_staged) = staged?;

    let files = changed_files(backend, root, &status.entries, &staged, &unstaged);
    let tracked = against_head(&status, staged, unstaged, of_staged)?;
    Ok(RepositorySnapshot {
        files,
        summary: summarize(&status, &tracked),
    })
}

/// The changed files of `entries`, each area of a path its own, with their counts: the staged
/// and unstaged ones from the numstats, the untracked ones read within the budget.
fn changed_files(
    backend: &dyn RepositoryBackend,
    root: &Path,
    entries: &[StatusEntry],
    staged: &Numstat,
    unstaged: &Numstat,
) -> Vec<ChangedFile> {
    let mut files = Vec::new();
    let mut budget = UntrackedBudget::new();
    for entry in entries {
        if let Some(kind) = entry.staged {
            let counts = staged.of(&entry.path);
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
                let counts = unstaged.of(&entry.path);
                files.push(changed_file(entry, ChangeArea::Unstaged, kind, counts));
            }
            None => {}
        }
    }
    files
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
        // a staged file compares HEAD with the index, an unstaged one the index with the tree
        old_blob: match area {
            ChangeArea::Staged => entry.head_blob.clone(),
            ChangeArea::Unstaged => entry.index_blob.clone(),
            ChangeArea::Untracked => None,
        },
        new_blob: match area {
            ChangeArea::Staged => entry.index_blob.clone(),
            ChangeArea::Unstaged | ChangeArea::Untracked => None,
        },
    }
}

/// The summary alone, for a project shown only as its row or its avatar: `git status` and the
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
    use crate::modules::folder::{FakeBackend, GitOutput};

    /// `git status` printing `stdout`, cut by the transport when `truncated`.
    struct FakeStatus {
        stdout: Vec<u8>,
        truncated: bool,
    }

    impl FakeBackend for FakeStatus {
        fn git(&self, _cwd: &Path, _args: &[&str], _max: usize) -> anyhow::Result<GitOutput> {
            Ok(GitOutput {
                code: if self.truncated { -1 } else { 0 },
                stdout: self.stdout.clone(),
                stderr: String::new(),
                truncated: self.truncated,
            })
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
}
