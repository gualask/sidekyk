//! Wire contracts shared with the frontend (`src/modules/repository/model/repository.types.ts`).

use serde::{Deserialize, Serialize};

pub(crate) const REPOSITORY_CHANGED_EVENT: &str = "repository-changed";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryInfo {
    pub(crate) root: String,
    pub(crate) name: String,
}

/// Emitted when files or refs of the project on screen changed on disk. The frontend refetches
/// what it shows of that repository.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryChangedEvent {
    pub(crate) version: u8,
    pub(crate) root: String,
    /// The index, HEAD or refs changed too: the recent commits may have, and only then are they
    /// read again.
    pub(crate) git_dir: bool,
}

impl RepositoryChangedEvent {
    pub(crate) fn new(root: &str, git_dir: bool) -> Self {
        Self {
            version: 1,
            root: root.to_string(),
            git_dir,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchStatus {
    /// Branch name, or `None` when HEAD is detached.
    pub(crate) head: Option<String>,
    /// Abbreviated HEAD commit, or `None` before the first commit.
    pub(crate) commit: Option<String>,
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: u32,
    pub(crate) behind: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChangeArea {
    Staged,
    Unstaged,
    Untracked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

/// One file in one area. A file with both staged and unstaged edits appears twice.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangedFile {
    pub(crate) path: String,
    pub(crate) orig_path: Option<String>,
    pub(crate) area: ChangeArea,
    pub(crate) kind: ChangeKind,
    /// `None` for binary files and for files that were not counted.
    pub(crate) additions: Option<u32>,
    pub(crate) deletions: Option<u32>,
    pub(crate) binary: bool,
}

/// Everything that differs from HEAD, staged or not. `files` counts every changed path, new files
/// included; the lines are those of tracked files, since a summary does not read new files.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeTotals {
    pub(crate) files: u32,
    pub(crate) additions: u32,
    pub(crate) deletions: u32,
}

/// One changed path and its line counts, whatever compares it: a summary against HEAD (whatever
/// the path's areas), or a commit against its parent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileChange {
    pub(crate) path: String,
    pub(crate) orig_path: Option<String>,
    pub(crate) kind: ChangeKind,
    /// `None` for binary files, and for files whose lines were not read: new files in a summary,
    /// files past a cut list.
    pub(crate) additions: Option<u32>,
    pub(crate) deletions: Option<u32>,
    pub(crate) binary: bool,
}

/// A repository at a glance: its card, its avatar in the rail, the breadcrumb. Cheap enough to
/// load for every project on screen (`git status` and one numstat against HEAD).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositorySummary {
    pub(crate) branch: BranchStatus,
    pub(crate) totals: ChangeTotals,
    /// The first changed paths in git's order, at most `SUMMARY_FILES`.
    pub(crate) files: Vec<FileChange>,
    /// git listed more changes than are read (`MAX_CHANGED_PATHS`, as VS Code): the list and the
    /// count of files stop there.
    pub(crate) truncated: bool,
}

/// Everything the Changes panel shows of a repository. Its summary is the one
/// `get_repository_summary` returns, built from the same git output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositorySnapshot {
    pub(crate) files: Vec<ChangedFile>,
    pub(crate) summary: RepositorySummary,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDiffRequest {
    pub(crate) path: String,
    pub(crate) orig_path: Option<String>,
    pub(crate) area: ChangeArea,
    /// Every line of the file as context, for the whole-file view; otherwise three, as git's.
    #[serde(default)]
    pub(crate) whole_file: bool,
}

/// A unified diff as git prints it, of a changed file or of a file of a commit. The frontend
/// parses it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnifiedDiff {
    pub(crate) text: String,
    /// Larger than `MAX_DIFF_BYTES`: cut at its last whole line.
    pub(crate) truncated: bool,
}

/// One commit of the branch on screen, as the recent commits list it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Commit {
    /// The full hash.
    pub(crate) sha: String,
    /// The first parent, `None` for a root commit. A merge shows what it brought to it, as VS
    /// Code does.
    pub(crate) parent: Option<String>,
    /// The commit has more than one parent.
    pub(crate) merge: bool,
    pub(crate) author: String,
    /// The author date, in seconds since the Unix epoch.
    pub(crate) time: i64,
    pub(crate) subject: String,
}

/// The last commits of the branch on screen, newest first, following first parents: the commits
/// of a branch merged into it are in its merge.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentCommits {
    pub(crate) commits: Vec<Commit>,
    /// The branch has older commits than those listed.
    pub(crate) more: bool,
}

/// A commit, and the parent it is compared with (`Commit::parent`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitRequest {
    pub(crate) sha: String,
    pub(crate) parent: Option<String>,
}

/// The files a commit changed, in git's order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitFiles {
    pub(crate) files: Vec<FileChange>,
    /// The commit changed more files than are read (`MAX_CHANGED_PATHS`, as a snapshot).
    pub(crate) truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitFileDiffRequest {
    pub(crate) commit: CommitRequest,
    pub(crate) path: String,
    pub(crate) orig_path: Option<String>,
    /// Every line of the file as context, for the whole-file view; otherwise three, as git's.
    #[serde(default)]
    pub(crate) whole_file: bool,
}

/// One entry of a folder in the Files panel's tree.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TreeEntry {
    /// The name shown: a folder holding only one folder shares its entry with it, so a folder's
    /// name may be several ("modules/changes").
    pub(crate) name: String,
    /// From the root, with `/` between names; for a shared entry, the deepest folder's.
    pub(crate) path: String,
    pub(crate) folder: bool,
}

/// What a folder holds, folders first, each in the order of VS Code's explorer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Directory {
    pub(crate) entries: Vec<TreeEntry>,
    /// Entries past the most a folder lists.
    pub(crate) more: u32,
    /// The repository has more files than the tree shows (`MAX_TREE_PATHS`).
    pub(crate) truncated: bool,
}

/// A file as the Files panel shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum FileContent {
    Text {
        text: String,
        /// Larger than `MAX_FILE_BYTES`: cut at its last whole line.
        truncated: bool,
    },
    Binary,
    /// A symbolic link, not followed: where it points, as git stores it.
    Link {
        target: String,
    },
    /// A folder git lists as one entry: a submodule.
    Folder,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_serializes_with_the_frontend_field_names() {
        let snapshot = RepositorySnapshot {
            files: vec![ChangedFile {
                path: "b.ts".into(),
                orig_path: Some("a.ts".into()),
                area: ChangeArea::Staged,
                kind: ChangeKind::TypeChanged,
                additions: None,
                deletions: Some(2),
                binary: false,
            }],
            summary: RepositorySummary {
                branch: BranchStatus {
                    head: Some("main".into()),
                    commit: Some("abc1234".into()),
                    upstream: Some("origin/main".into()),
                    ahead: 1,
                    behind: 0,
                },
                totals: ChangeTotals {
                    files: 1,
                    additions: 0,
                    deletions: 2,
                },
                files: vec![FileChange {
                    path: "b.ts".into(),
                    orig_path: Some("a.ts".into()),
                    kind: ChangeKind::TypeChanged,
                    additions: None,
                    deletions: Some(2),
                    binary: false,
                }],
                truncated: false,
            },
        };

        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "files": [{
                    "path": "b.ts",
                    "origPath": "a.ts",
                    "area": "staged",
                    "kind": "type-changed",
                    "additions": null,
                    "deletions": 2,
                    "binary": false
                }],
                "summary": {
                    "branch": {
                        "head": "main",
                        "commit": "abc1234",
                        "upstream": "origin/main",
                        "ahead": 1,
                        "behind": 0
                    },
                    "totals": { "files": 1, "additions": 0, "deletions": 2 },
                    "files": [{
                        "path": "b.ts",
                        "origPath": "a.ts",
                        "kind": "type-changed",
                        "additions": null,
                        "deletions": 2,
                        "binary": false
                    }],
                    "truncated": false
                }
            })
        );
    }

    #[test]
    fn file_diff_request_reads_the_frontend_payload() {
        let request: FileDiffRequest = serde_json::from_value(serde_json::json!({
            "path": "src/a.ts",
            "origPath": null,
            "area": "untracked",
            "wholeFile": true
        }))
        .unwrap();
        assert_eq!(request.area, ChangeArea::Untracked);
        assert_eq!(request.orig_path, None);
        assert!(request.whole_file);
    }

    #[test]
    fn repository_changed_event_is_versioned() {
        assert_eq!(
            serde_json::to_value(RepositoryChangedEvent::new("/r", true)).unwrap(),
            serde_json::json!({ "version": 1, "root": "/r", "gitDir": true })
        );
    }

    #[test]
    fn recent_commits_serialize_with_the_frontend_field_names() {
        let commits = RecentCommits {
            commits: vec![Commit {
                sha: "a1b2c3d4".into(),
                parent: None,
                merge: false,
                author: "Ada".into(),
                time: 1_760_000_000,
                subject: "Add the cart".into(),
            }],
            more: true,
        };
        assert_eq!(
            serde_json::to_value(commits).unwrap(),
            serde_json::json!({
                "commits": [{
                    "sha": "a1b2c3d4",
                    "parent": null,
                    "merge": false,
                    "author": "Ada",
                    "time": 1_760_000_000,
                    "subject": "Add the cart"
                }],
                "more": true
            })
        );
    }

    #[test]
    fn commit_files_serialize_with_the_frontend_field_names() {
        let files = CommitFiles {
            files: vec![FileChange {
                path: "b.ts".into(),
                orig_path: Some("a.ts".into()),
                kind: ChangeKind::Renamed,
                additions: Some(1),
                deletions: Some(0),
                binary: false,
            }],
            truncated: false,
        };
        assert_eq!(
            serde_json::to_value(files).unwrap(),
            serde_json::json!({
                "files": [{
                    "path": "b.ts",
                    "origPath": "a.ts",
                    "kind": "renamed",
                    "additions": 1,
                    "deletions": 0,
                    "binary": false
                }],
                "truncated": false
            })
        );
        let diff = UnifiedDiff {
            text: "@@".into(),
            truncated: true,
        };
        assert_eq!(
            serde_json::to_value(diff).unwrap(),
            serde_json::json!({ "text": "@@", "truncated": true })
        );
    }

    #[test]
    fn the_tree_and_its_files_serialize_with_the_frontend_field_names() {
        let directory = Directory {
            entries: vec![TreeEntry {
                name: "modules/changes".into(),
                path: "src/modules/changes".into(),
                folder: true,
            }],
            more: 2,
            truncated: false,
        };
        assert_eq!(
            serde_json::to_value(directory).unwrap(),
            serde_json::json!({
                "entries": [{ "name": "modules/changes", "path": "src/modules/changes", "folder": true }],
                "more": 2,
                "truncated": false
            })
        );
        let cases = [
            (
                FileContent::Text {
                    text: "a\n".into(),
                    truncated: true,
                },
                serde_json::json!({ "kind": "text", "text": "a\n", "truncated": true }),
            ),
            (FileContent::Binary, serde_json::json!({ "kind": "binary" })),
            (
                FileContent::Link {
                    target: "../x".into(),
                },
                serde_json::json!({ "kind": "link", "target": "../x" }),
            ),
            (FileContent::Folder, serde_json::json!({ "kind": "folder" })),
        ];
        for (content, json) in cases {
            assert_eq!(serde_json::to_value(content).unwrap(), json);
        }
    }

    #[test]
    fn commit_file_diff_request_reads_the_frontend_payload() {
        let request: CommitFileDiffRequest = serde_json::from_value(serde_json::json!({
            "commit": { "sha": "a1b2c3d", "parent": "0f9e8d7" },
            "path": "b.ts",
            "origPath": "a.ts",
            "wholeFile": false
        }))
        .unwrap();
        assert_eq!(
            request,
            CommitFileDiffRequest {
                commit: CommitRequest {
                    sha: "a1b2c3d".into(),
                    parent: Some("0f9e8d7".into()),
                },
                path: "b.ts".into(),
                orig_path: Some("a.ts".into()),
                whole_file: false,
            }
        );
    }
}
