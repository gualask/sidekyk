//! The commits of the graph, HEAD's and its upstream's as VS Code's graph shows them, the files
//! each one changed, and their diffs. Read when the list is opened, never in the background.

use std::collections::HashMap;
use std::path::Path;

use super::contracts::{
    ChangeKind, Commit, CommitFileDiffRequest, CommitFiles, CommitRef, CommitRefKind,
    CommitRequest, FileChange, RecentCommits, UnifiedDiff,
};
use super::diff::{context_option, unified_diff};
use super::limits::{MAX_CHANGED_PATHS, MAX_DIFF_BYTES, MAX_NUMSTAT_BYTES};
use super::numstat::{parse_numstat_z, Counts};
use super::status::{kind_of, object_id};
use crate::modules::folder::{
    checked_path, existing_root, git_checked, RepositoryBackend, RepositoryInfo, LITERAL_PATHSPECS,
};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// How many commits a page of the graph lists, as VS Code's (`scm.graph.pageSize`).
const RECENT_COMMITS: usize = 50;

/// Hash, parents, author, author date, refs (`--decorate=full`) and subject, each ended by a NUL:
/// `-z` writes the last.
const LOG_FORMAT: &str = "--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s";
const LOG_FIELDS: usize = 6;

/// Far more than the listed commits take, unless their subjects are huge.
const MAX_LOG_BYTES: usize = 1024 * 1024;

/// A full ref name, `refs/remotes/origin/main`.
const MAX_REF_BYTES: usize = 4096;

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

/// The commits of `git log -z` in `LOG_FORMAT`, each with the refs the graph names (`named_refs`;
/// `upstream` a full name). Only whole records count: output cut anywhere loses its last commit
/// instead of showing it half read.
fn parse_log_z(bytes: &[u8], upstream: Option<&str>) -> Vec<Commit> {
    let text = String::from_utf8_lossy(bytes);
    let fields: Vec<&str> = text.split('\0').collect();
    // what follows the last NUL is an unfinished field, or nothing
    let ended = &fields[..fields.len() - 1];
    let (records, _) = ended.as_chunks::<LOG_FIELDS>();
    records
        .iter()
        .map(|[sha, parents, author, time, refs, subject]| Commit {
            sha: sha.to_string(),
            parents: parents
                .split(' ')
                .filter(|p| !p.is_empty())
                .map(str::to_string)
                .collect(),
            author: author.to_string(),
            time: time.parse().unwrap_or(0),
            subject: subject.to_string(),
            refs: named_refs(refs, upstream),
        })
        .collect()
}

/// The refs of `decorations` (`%D` with `--decorate=full`: `HEAD -> refs/heads/main,
/// refs/remotes/origin/main, tag: refs/tags/v1`) the graph names: the branch checked out, its
/// `upstream` (a full name) and the tags, in that order; other branches are left out, as VS Code's
/// graph leaves out what it does not draw.
fn named_refs(decorations: &str, upstream: Option<&str>) -> Vec<CommitRef> {
    let mut refs: Vec<CommitRef> = decorations
        .split(", ")
        .filter_map(|decoration| {
            let (name, kind) = if let Some(branch) = decoration.strip_prefix("HEAD -> ") {
                (short_ref(branch), CommitRefKind::Head)
            } else if decoration == "HEAD" {
                ("HEAD", CommitRefKind::Head)
            } else if let Some(tag) = decoration.strip_prefix("tag: refs/tags/") {
                (tag, CommitRefKind::Tag)
            } else if upstream == Some(decoration) {
                (short_ref(decoration), CommitRefKind::Upstream)
            } else {
                return None;
            };
            Some(CommitRef {
                name: name.to_string(),
                kind,
            })
        })
        .collect();
    // stable: tags keep git's order
    refs.sort_by_key(|r| r.kind);
    refs
}

/// `main` for `refs/heads/main`, `origin/main` for `refs/remotes/origin/main`.
fn short_ref(full: &str) -> &str {
    full.strip_prefix("refs/heads/")
        .or_else(|| full.strip_prefix("refs/remotes/"))
        .unwrap_or(full)
}

/// The full name of the branch HEAD's branch tracks, if it has one: none on a detached HEAD.
fn upstream(backend: &dyn RepositoryBackend, root: &Path) -> anyhow::Result<Option<String>> {
    let out = backend.git(
        root,
        &["rev-parse", "--symbolic-full-name", "@{upstream}"],
        MAX_REF_BYTES,
    )?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // a ref git names never starts with `-`, which would read as an option
    Ok((out.code == 0 && name.starts_with("refs/")).then_some(name))
}

/// A page of the graph: the commits of HEAD and of its upstream, children before their parents,
/// after the first `skip`; none before the first commit.
pub fn load_recent_commits(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    skip: usize,
) -> anyhow::Result<RecentCommits> {
    let root = existing_root(backend, repository)?;
    let upstream = upstream(backend, root)?;
    // one more than listed, to know whether there are older ones
    let count = format!("-n{}", RECENT_COMMITS + 1);
    let skip = format!("--skip={skip}");
    let mut args = vec![
        "log",
        "-z",
        LOG_FORMAT,
        &count,
        &skip,
        // children before parents, which the graph's lanes need; with git's commit-graph file it
        // does not walk the whole history (VS Code's graph sorts so too)
        "--topo-order",
        "--decorate=full",
        // `log.showSignature` in the user's config would run gpg for every commit
        "--no-show-signature",
        // before the first commit HEAD names nothing: an empty list, not a failure
        "--ignore-missing",
        "HEAD",
    ];
    args.extend(upstream.as_deref());
    args.push("--");
    let out = git_checked(backend, root, &args, &[0], MAX_LOG_BYTES)?;
    let mut commits = parse_log_z(&out.stdout, upstream.as_deref());
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
    let mut args = vec![LITERAL_PATHSPECS, "diff-tree", "--no-commit-id", "-M"];
    args.extend_from_slice(options);
    match parent {
        Some(parent) => args.extend([parent, sha]),
        None => args.extend(["--root", sha]),
    }
    args.push("--");
    args.extend_from_slice(paths);
    Ok(args)
}

/// A field of `-z` output, taken off `rest`; none when cut short.
fn field(rest: &mut &[u8]) -> Option<String> {
    let end = rest.iter().position(|&b| b == 0)?;
    let field = String::from_utf8_lossy(&rest[..end]).into_owned();
    *rest = &rest[end + 1..];
    Some(field)
}

/// A raw record of `git diff-tree -z`, taken off `rest`; none when cut short.
fn raw_record(rest: &mut &[u8]) -> Option<FileChange> {
    let meta = field(rest)?;
    // `:<old mode> <new mode> <old id> <new id> <status>`
    let parts: Vec<&str> = meta.split(' ').collect();
    let status = parts.last().and_then(|s| s.chars().next());
    let blob = |at: usize| parts.get(at).copied().and_then(object_id);
    let (old_blob, new_blob) = (blob(2), blob(3));
    let first = field(rest)?;
    let (path, orig_path) = if matches!(status, Some('R' | 'C')) {
        (field(rest)?, Some(first))
    } else {
        (first, None)
    };
    Some(FileChange {
        path,
        orig_path,
        kind: status.and_then(kind_of).unwrap_or(ChangeKind::Modified),
        additions: None,
        deletions: None,
        binary: false,
        old_blob,
        new_blob,
    })
}

/// The entries of `git diff-tree -z --raw --numstat`: every raw record first (`:<modes> <ids>
/// <status>`, then the path, or the old and the new path of a rename or a copy), then the
/// numstat records. Output `truncated` anywhere keeps its whole raw records, and drops its last
/// numstat record, which may be cut in its path and match another file (as a snapshot does).
fn parse_diff_tree_z(bytes: &[u8], truncated: bool) -> Vec<FileChange> {
    let mut rest = bytes;
    let mut files = Vec::new();
    while rest.first() == Some(&b':') {
        let Some(file) = raw_record(&mut rest) else {
            break;
        };
        files.push(file);
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
pub fn load_commit_files(
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
pub fn load_commit_file_diff(
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
    Ok(unified_diff(out))
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
        let out = b"c3\0b2\0Ada\x001760000000\0HEAD -> refs/heads/main, tag: refs/tags/v1\0Add the cart\0\
b2\0a1 f6\0Bo\x001750000000\0refs/remotes/origin/main, refs/remotes/origin/HEAD\0Merge\0\
a1\0\0Ada\x00100\0refs/heads/other\0Root\0";
        let upstream = Some("refs/remotes/origin/main");
        let commits = parse_log_z(out, upstream);
        fn parents(c: &Commit) -> Vec<&str> {
            c.parents.iter().map(String::as_str).collect()
        }
        assert_eq!(
            commits
                .iter()
                .map(|c| (c.sha.as_str(), parents(c), c.subject.as_str()))
                .collect::<Vec<_>>(),
            [
                ("c3", vec!["b2"], "Add the cart"),
                ("b2", vec!["a1", "f6"], "Merge"),
                ("a1", vec![], "Root"),
            ]
        );
        let named = |name: &str, kind| CommitRef {
            name: name.into(),
            kind,
        };
        // the branch checked out, its upstream and the tags: no other branch
        assert_eq!(
            commits[0].refs,
            [
                named("main", CommitRefKind::Head),
                named("v1", CommitRefKind::Tag)
            ]
        );
        assert_eq!(
            commits[1].refs,
            [named("origin/main", CommitRefKind::Upstream)]
        );
        assert!(commits[2].refs.is_empty());
        assert_eq!(commits[0].author, "Ada");
        assert_eq!(commits[0].time, 1_760_000_000);

        let cut = &out[..out.len() - 3];
        assert_eq!(parse_log_z(cut, upstream).len(), 2);
        assert!(parse_log_z(b"", upstream).is_empty());
        // a detached HEAD, on the upstream's commit
        let detached = parse_log_z(
            b"c3\0\0Ada\x001\0HEAD, refs/remotes/origin/main\0S\0",
            upstream,
        );
        assert_eq!(
            detached[0].refs,
            [
                named("HEAD", CommitRefKind::Head),
                named("origin/main", CommitRefKind::Upstream)
            ]
        );
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
                    old_blob: Some("aa".into()),
                    new_blob: Some("bb".into()),
                },
                FileChange {
                    path: "logo.png".into(),
                    orig_path: None,
                    kind: ChangeKind::Added,
                    additions: None,
                    deletions: None,
                    binary: true,
                    // no parent's file: git prints an id of zeros
                    old_blob: None,
                    new_blob: Some("cc".into()),
                },
                FileChange {
                    path: "new.ts".into(),
                    orig_path: Some("old.ts".into()),
                    kind: ChangeKind::Renamed,
                    additions: Some(2),
                    deletions: Some(0),
                    binary: false,
                    old_blob: Some("dd".into()),
                    new_blob: Some("ee".into()),
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
                "--literal-pathspecs",
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
                "--literal-pathspecs",
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
