//! The recent commits of the branch on screen, as VS Code's source control lists them, the files
//! each one changed, and their diffs. Read when the list is opened, never in the background.

use std::collections::HashMap;

use super::contracts::{
    ChangeKind, Commit, CommitFileDiffRequest, CommitFiles, CommitRequest, FileChange,
    RecentCommits, RepositoryInfo, UnifiedDiff,
};
use super::diff::{checked_path, context_option, cut_at_line};
use super::limits::{MAX_CHANGED_PATHS, MAX_DIFF_BYTES, MAX_NUMSTAT_BYTES};
use super::numstat::{parse_numstat_z, Counts};
use super::open::existing_root;
use super::ports::{git_checked, RepositoryBackend};
use super::status::kind_of;
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// How many commits are listed, as many as a page of VS Code's graph (`scm.graph.pageSize`).
const RECENT_COMMITS: usize = 50;

/// Hash, parents, author, author date and subject, each ended by a NUL: `-z` writes the last.
const LOG_FORMAT: &str = "--format=%H%x00%P%x00%an%x00%at%x00%s";
const LOG_FIELDS: usize = 5;

/// Far more than the listed commits take, unless their subjects are huge.
const MAX_LOG_BYTES: usize = 1024 * 1024;

/// What git takes for a commit: a whole or abbreviated hash. Anything else is refused before
/// git runs, so the frontend cannot pass an option or a revision expression.
pub(super) fn checked_commit(id: &str) -> anyhow::Result<&str> {
    let hash = (4..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit());
    if hash {
        Ok(id)
    } else {
        Err(user_facing(UserFacingErrorCode::InvalidCommit))
    }
}

/// The commits of `git log -z` in `LOG_FORMAT`. Only whole records count: output cut anywhere
/// loses its last commit instead of showing it half read.
fn parse_log_z(bytes: &[u8]) -> Vec<Commit> {
    let text = String::from_utf8_lossy(bytes);
    let fields: Vec<&str> = text.split('\0').collect();
    // what follows the last NUL is an unfinished field, or nothing
    let ended = &fields[..fields.len() - 1];
    let (records, _) = ended.as_chunks::<LOG_FIELDS>();
    records
        .iter()
        .map(|[sha, parents, author, time, subject]| {
            let mut parents = parents.split(' ').filter(|p| !p.is_empty());
            Commit {
                sha: sha.to_string(),
                parent: parents.next().map(str::to_string),
                merge: parents.next().is_some(),
                author: author.to_string(),
                time: time.parse().unwrap_or(0),
                subject: subject.to_string(),
            }
        })
        .collect()
}

/// The last commits of the branch on screen, newest first, along first parents; none before the
/// first commit.
pub(crate) fn load_recent_commits(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<RecentCommits> {
    let root = existing_root(backend, repository)?;
    // one more than listed, to know whether there are older ones
    let count = format!("-n{}", RECENT_COMMITS + 1);
    let out = git_checked(
        backend,
        root,
        &[
            "log",
            "-z",
            LOG_FORMAT,
            &count,
            // the branch's own history, one commit after the other: a merge stands for the
            // commits it brought
            "--first-parent",
            // `log.showSignature` in the user's config would run gpg for every commit
            "--no-show-signature",
            // before the first commit HEAD names nothing: an empty list, not a failure
            "--ignore-missing",
            "HEAD",
            "--",
        ],
        &[0],
        MAX_LOG_BYTES,
    )?;
    let mut commits = parse_log_z(&out.stdout);
    let more = out.truncated || commits.len() > RECENT_COMMITS;
    commits.truncate(RECENT_COMMITS);
    Ok(RecentCommits { commits, more })
}

/// `git diff-tree` between a commit and its parent, or against nothing for a root commit, with
/// `options` before the commits and `paths` after them.
fn diff_tree_args<'a>(
    options: &[&'a str],
    commit: &'a CommitRequest,
    paths: &[&'a str],
) -> anyhow::Result<Vec<&'a str>> {
    let sha = checked_commit(&commit.sha)?;
    let parent = commit.parent.as_deref().map(checked_commit).transpose()?;
    let mut args = vec!["diff-tree", "--no-commit-id", "-M"];
    args.extend_from_slice(options);
    match parent {
        Some(parent) => args.extend([parent, sha]),
        None => args.extend(["--root", sha]),
    }
    args.push("--");
    args.extend_from_slice(paths);
    Ok(args)
}

/// The entries of `git diff-tree -z --raw --numstat`: every raw record first (`:<modes> <ids>
/// <status>`, then the path, or the old and the new path of a rename or a copy), then the
/// numstat records. Output `truncated` anywhere keeps its whole raw records, and drops its last
/// numstat record, which may be cut in its path and match another file (as a snapshot does).
fn parse_diff_tree_z(bytes: &[u8], truncated: bool) -> Vec<FileChange> {
    fn field(rest: &mut &[u8]) -> Option<String> {
        let end = rest.iter().position(|&b| b == 0)?;
        let field = String::from_utf8_lossy(&rest[..end]).into_owned();
        *rest = &rest[end + 1..];
        Some(field)
    }

    let mut rest = bytes;
    let mut files = Vec::new();
    while rest.first() == Some(&b':') {
        let Some(meta) = field(&mut rest) else { break };
        let status = meta.rsplit(' ').next().and_then(|s| s.chars().next());
        let Some(first) = field(&mut rest) else { break };
        let (path, orig_path) = if matches!(status, Some('R' | 'C')) {
            let Some(second) = field(&mut rest) else {
                break;
            };
            (second, Some(first))
        } else {
            (first, None)
        };
        files.push(FileChange {
            path,
            orig_path,
            kind: status.and_then(kind_of).unwrap_or(ChangeKind::Modified),
            additions: None,
            deletions: None,
            binary: false,
        });
    }
    if rest.first() == Some(&b':') {
        // cut in the raw records: no numstat follows
        return files;
    }

    let mut numstat = parse_numstat_z(rest);
    if truncated {
        numstat.pop();
    }
    let mut counts: HashMap<String, Counts> =
        numstat.into_iter().map(|c| (c.path, c.counts)).collect();
    for file in &mut files {
        let found = counts.remove(&file.path).unwrap_or_default();
        file.additions = found.additions;
        file.deletions = found.deletions;
        file.binary = found.binary;
    }
    files
}

/// The files a commit changed, with their line counts, at most `MAX_CHANGED_PATHS`.
pub(crate) fn load_commit_files(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    commit: &CommitRequest,
) -> anyhow::Result<CommitFiles> {
    let root = existing_root(backend, repository)?;
    let args = diff_tree_args(&["-r", "-z", "--raw", "--numstat"], commit, &[])?;
    let out = git_checked(backend, root, &args, &[0], MAX_NUMSTAT_BYTES)?;
    let mut files = parse_diff_tree_z(&out.stdout, out.truncated);
    let truncated = out.truncated || files.len() > MAX_CHANGED_PATHS;
    files.truncate(MAX_CHANGED_PATHS);
    Ok(CommitFiles { files, truncated })
}

/// The unified diff of one file of a commit, against its parent.
pub(crate) fn load_commit_file_diff(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    request: &CommitFileDiffRequest,
) -> anyhow::Result<UnifiedDiff> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(&request.path)?;
    let orig_path = request.orig_path.as_deref().map(checked_path).transpose()?;
    // both sides of a rename, so git can pair them
    let paths: Vec<&str> = orig_path.into_iter().chain([path]).collect();
    let args = diff_tree_args(
        &[
            "-p",
            "--no-color",
            "--no-ext-diff",
            context_option(request.whole_file),
        ],
        &request.commit,
        &paths,
    )?;
    let out = git_checked(backend, root, &args, &[0], MAX_DIFF_BYTES)?;
    let bytes = if out.truncated {
        cut_at_line(out.stdout)
    } else {
        out.stdout
    };
    Ok(UnifiedDiff {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated: out.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hashes_pass_as_commits() {
        for good in [
            "a1b2",
            "0123456789abcdef0123456789abcdef01234567",
            "ABCDEF0",
        ] {
            assert!(checked_commit(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "abc",
            "HEAD",
            "--output=x",
            "a1b2~1",
            "main",
            &"a".repeat(65),
        ] {
            assert!(checked_commit(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn log_records_read_whole_and_a_cut_one_is_dropped() {
        let out = b"c3\0b2\0Ada\x001760000000\0Add the cart\0b2\0a1 f6\0Bo\x001750000000\0Merge\0a1\0\0Ada\x00100\0Root\0";
        let commits = parse_log_z(out);
        assert_eq!(
            commits
                .iter()
                .map(|c| (c.sha.as_str(), c.parent.as_deref(), c.subject.as_str()))
                .collect::<Vec<_>>(),
            [
                ("c3", Some("b2"), "Add the cart"),
                ("b2", Some("a1"), "Merge"),
                ("a1", None, "Root"),
            ]
        );
        assert_eq!(
            commits.iter().map(|c| c.merge).collect::<Vec<_>>(),
            [false, true, false]
        );
        assert_eq!(commits[0].author, "Ada");
        assert_eq!(commits[0].time, 1_760_000_000);

        let cut = &out[..out.len() - 3];
        assert_eq!(parse_log_z(cut).len(), 2);
        assert!(parse_log_z(b"").is_empty());
    }

    #[test]
    fn diff_tree_entries_take_their_kind_paths_and_counts() {
        let out = b":100644 100644 aa bb M\0src/a.ts\0:000000 100644 00 cc A\0logo.png\0:100644 100644 dd ee R086\0old.ts\0new.ts\0\
3\t1\tsrc/a.ts\0-\t-\tlogo.png\x002\t0\t\0old.ts\0new.ts\0";
        assert_eq!(
            parse_diff_tree_z(out, false),
            vec![
                FileChange {
                    path: "src/a.ts".into(),
                    orig_path: None,
                    kind: ChangeKind::Modified,
                    additions: Some(3),
                    deletions: Some(1),
                    binary: false,
                },
                FileChange {
                    path: "logo.png".into(),
                    orig_path: None,
                    kind: ChangeKind::Added,
                    additions: None,
                    deletions: None,
                    binary: true,
                },
                FileChange {
                    path: "new.ts".into(),
                    orig_path: Some("old.ts".into()),
                    kind: ChangeKind::Renamed,
                    additions: Some(2),
                    deletions: Some(0),
                    binary: false,
                },
            ]
        );
    }

    #[test]
    fn diff_tree_cut_in_its_raw_records_keeps_the_whole_ones_uncounted() {
        let out = b":100644 100644 aa bb M\0src/a.ts\0:000000 100644 00 cc A\0lo";
        let files = parse_diff_tree_z(out, true);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/a.ts");
        assert_eq!(files[0].additions, None);
    }

    #[test]
    fn diff_tree_cut_in_its_numstat_drops_the_last_count() {
        let out = b":100644 100644 aa bb M\0src/a\0:100644 100644 cc dd M\0src/a.ts\0\
3\t1\tsrc/a\x002\t0\tsrc/a";
        let files = parse_diff_tree_z(out, true);
        assert_eq!(files[0].additions, Some(3));
        assert_eq!(
            files[1].additions, None,
            "src/a.ts cut to src/a must not count"
        );
    }

    #[test]
    fn a_root_commit_is_compared_with_nothing() {
        let root = CommitRequest {
            sha: "a1b2c3d".into(),
            parent: None,
        };
        assert_eq!(
            diff_tree_args(&["-p"], &root, &["a.ts"]).unwrap(),
            [
                "diff-tree",
                "--no-commit-id",
                "-M",
                "-p",
                "--root",
                "a1b2c3d",
                "--",
                "a.ts"
            ]
        );
        let child = CommitRequest {
            sha: "a1b2c3d".into(),
            parent: Some("f0e1d2c".into()),
        };
        assert_eq!(
            diff_tree_args(&[], &child, &[]).unwrap(),
            [
                "diff-tree",
                "--no-commit-id",
                "-M",
                "f0e1d2c",
                "a1b2c3d",
                "--"
            ]
        );
        let forged = CommitRequest {
            sha: "a1b2c3d".into(),
            parent: Some("--output=/tmp/x".into()),
        };
        assert!(diff_tree_args(&[], &forged, &[]).is_err());
    }
}
