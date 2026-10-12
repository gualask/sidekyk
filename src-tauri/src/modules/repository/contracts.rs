//! Wire contracts shared with the frontend (`src/modules/changes/model/repository.types.ts`).

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
}

impl RepositoryChangedEvent {
    pub(crate) fn new(root: &str) -> Self {
        Self {
            version: 1,
            root: root.to_string(),
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

/// One changed path against HEAD, whatever its areas.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SummaryFile {
    pub(crate) path: String,
    pub(crate) kind: ChangeKind,
    /// `None` for binary files and for new files, which a summary does not read.
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
    pub(crate) files: Vec<SummaryFile>,
}

/// Everything the Changes panel shows of a repository. Its summary is the one
/// `get_repository_summary` returns, built from the same git output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositorySnapshot {
    pub(crate) repository: RepositoryInfo,
    pub(crate) files: Vec<ChangedFile>,
    pub(crate) summary: RepositorySummary,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDiffRequest {
    pub(crate) path: String,
    pub(crate) orig_path: Option<String>,
    pub(crate) area: ChangeArea,
}

/// A unified diff as git prints it. The frontend parses it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDiff {
    pub(crate) path: String,
    pub(crate) area: ChangeArea,
    pub(crate) text: String,
    pub(crate) truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_serializes_with_the_frontend_field_names() {
        let snapshot = RepositorySnapshot {
            repository: RepositoryInfo {
                root: "/r".into(),
                name: "r".into(),
            },
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
                files: vec![SummaryFile {
                    path: "b.ts".into(),
                    kind: ChangeKind::TypeChanged,
                    additions: None,
                    deletions: Some(2),
                    binary: false,
                }],
            },
        };

        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "repository": { "root": "/r", "name": "r" },
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
                        "kind": "type-changed",
                        "additions": null,
                        "deletions": 2,
                        "binary": false
                    }]
                }
            })
        );
    }

    #[test]
    fn file_diff_request_reads_the_frontend_payload() {
        let request: FileDiffRequest = serde_json::from_value(serde_json::json!({
            "path": "src/a.ts",
            "origPath": null,
            "area": "untracked"
        }))
        .unwrap();
        assert_eq!(request.area, ChangeArea::Untracked);
        assert_eq!(request.orig_path, None);
    }

    #[test]
    fn repository_changed_event_is_versioned() {
        assert_eq!(
            serde_json::to_value(RepositoryChangedEvent::new("/r")).unwrap(),
            serde_json::json!({ "version": 1, "root": "/r" })
        );
    }
}
