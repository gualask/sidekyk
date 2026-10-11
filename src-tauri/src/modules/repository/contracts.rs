//! Wire contracts shared with the frontend (`src/modules/changes/model/repository.types.ts`).

use serde::{Deserialize, Serialize};

pub(crate) const REPOSITORY_CHANGED_EVENT: &str = "repository-changed";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryInfo {
    pub(crate) root: String,
    pub(crate) name: String,
}

/// Emitted when the open repository changes: another repository was opened, or files or refs
/// changed on disk. The frontend refetches everything it shows.
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
    /// `None` for binary files or when the count is unknown.
    pub(crate) additions: Option<u32>,
    pub(crate) deletions: Option<u32>,
}

/// Everything that differs from HEAD, staged or not, untracked files included.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeTotals {
    pub(crate) files: u32,
    pub(crate) additions: u32,
    pub(crate) deletions: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositorySnapshot {
    pub(crate) repository: RepositoryInfo,
    pub(crate) branch: BranchStatus,
    pub(crate) files: Vec<ChangedFile>,
    pub(crate) totals: ChangeTotals,
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
            branch: BranchStatus {
                head: Some("main".into()),
                commit: Some("abc1234".into()),
                upstream: Some("origin/main".into()),
                ahead: 1,
                behind: 0,
            },
            files: vec![ChangedFile {
                path: "b.ts".into(),
                orig_path: Some("a.ts".into()),
                area: ChangeArea::Staged,
                kind: ChangeKind::TypeChanged,
                additions: None,
                deletions: Some(2),
            }],
            totals: ChangeTotals {
                files: 1,
                additions: 0,
                deletions: 2,
            },
        };

        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "repository": { "root": "/r", "name": "r" },
                "branch": {
                    "head": "main",
                    "commit": "abc1234",
                    "upstream": "origin/main",
                    "ahead": 1,
                    "behind": 0
                },
                "files": [{
                    "path": "b.ts",
                    "origPath": "a.ts",
                    "area": "staged",
                    "kind": "type-changed",
                    "additions": null,
                    "deletions": 2
                }],
                "totals": { "files": 1, "additions": 0, "deletions": 2 }
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
