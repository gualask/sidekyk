use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::contracts::{
    ChangeArea, ChangeKind, ChangeTotals, ChangedFile, RepositoryInfo, RepositorySnapshot,
};
use super::numstat::{count_text_lines, parse_numstat_z, LineCounts};
use super::ports::{git_checked, RepositoryBackend};
use super::status::{parse_porcelain_v2, StatusEntry};

/// Untracked files larger than this get no line count.
const MAX_UNTRACKED_BYTES: u64 = 4 * 1024 * 1024;

type CountsByPath = HashMap<String, (Option<u32>, Option<u32>)>;

fn by_path(counts: Vec<LineCounts>) -> CountsByPath {
    counts
        .into_iter()
        .map(|c| (c.path, (c.additions, c.deletions)))
        .collect()
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

fn changed_file(
    entry: &StatusEntry,
    area: ChangeArea,
    kind: ChangeKind,
    counts: (Option<u32>, Option<u32>),
) -> ChangedFile {
    ChangedFile {
        path: entry.path.clone(),
        orig_path: entry.orig_path.clone(),
        area,
        kind,
        additions: counts.0,
        deletions: counts.1,
    }
}

fn sum(counts: impl Iterator<Item = (Option<u32>, Option<u32>)>) -> (u32, u32) {
    counts.fold((0, 0), |(a, d), (add, del)| {
        (
            a.saturating_add(add.unwrap_or(0)),
            d.saturating_add(del.unwrap_or(0)),
        )
    })
}

/// Branch, changed files and totals for the open repository.
pub(crate) fn load_snapshot(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<RepositorySnapshot> {
    let root = Path::new(&repository.root);
    let status = parse_porcelain_v2(&git_checked(
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
    )?);
    let unstaged = by_path(numstat(backend, root, &[])?);
    let staged = by_path(numstat(backend, root, &["--cached"])?);

    let mut files = Vec::new();
    let mut untracked_counts = Vec::new();
    for entry in &status.entries {
        if let Some(kind) = entry.staged {
            let counts = staged.get(&entry.path).copied().unwrap_or_default();
            files.push(changed_file(entry, ChangeArea::Staged, kind, counts));
        }
        match entry.unstaged {
            Some(ChangeKind::Untracked) => {
                let added = backend
                    .read_file(&root.join(&entry.path), MAX_UNTRACKED_BYTES)
                    .and_then(|bytes| count_text_lines(&bytes));
                let counts = (added, added.map(|_| 0));
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
        sum(by_path(numstat(backend, root, &["HEAD"])?).into_values())
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
