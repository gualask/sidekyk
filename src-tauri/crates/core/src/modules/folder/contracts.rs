//! A folder's wire contracts, with or without git, shared with the frontend
//! (`src/modules/repository/model/repository.types.ts`).

use serde::{Deserialize, Serialize};

pub const REPOSITORY_CHANGED_EVENT: &str = "repository-changed";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub root: String,
    pub name: String,
}

/// Files or refs of the repository watched changed on disk, in a way that shows: what reads the
/// repository tells the app, which tells the frontend (`RepositoryChangedEvent`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChange {
    /// The repository's root on the machine that holds it.
    pub root: String,
    /// The index, HEAD or refs changed too: the recent commits may have, and only then are they
    /// read again.
    pub git_dir: bool,
    /// The working tree's files or folders that changed, relative to the root with `/`, so an
    /// open file or diff no change touched is not read again; `None` when any may have (too
    /// many, git could not tell which are ignored, or a name is not UTF-8).
    pub paths: Option<Vec<String>>,
    /// A `.git` came or went at the root: the folder is now the other kind, and what was read of
    /// it is dropped rather than read again.
    pub kind_changed: bool,
}

impl RepositoryChange {
    /// Anything may have changed, git's files included: what the app shows is read again.
    pub fn anything(root: String) -> Self {
        Self {
            root,
            git_dir: true,
            paths: None,
            kind_changed: false,
        }
    }

    /// The folder at `root` became a repository, or stopped being one.
    pub fn kind(root: String) -> Self {
        Self {
            kind_changed: true,
            ..Self::anything(root)
        }
    }
}

/// Emitted when files or refs of the folder on screen changed on disk. The frontend refetches
/// what it shows of that folder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChangedEvent {
    /// 5 names the folder by its id; 4: with a change of kind; 3 brought the paths that changed;
    /// 2 named the project by its id, 1 by its root.
    pub version: u8,
    pub folder_id: String,
    /// As in `RepositoryChange`.
    pub git_dir: bool,
    /// As in `RepositoryChange`.
    pub paths: Option<Vec<String>>,
    /// As in `RepositoryChange`.
    pub kind_changed: bool,
}

impl RepositoryChangedEvent {
    pub fn new(folder_id: &str, change: RepositoryChange) -> Self {
        Self {
            version: 5,
            folder_id: folder_id.to_string(),
            git_dir: change.git_dir,
            paths: change.paths,
            kind_changed: change.kind_changed,
        }
    }
}

/// One entry of a folder in the Files panel's tree.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    /// The name shown: a folder holding only one folder shares its entry with it, so a folder's
    /// name may be several ("modules/changes").
    pub name: String,
    /// From the root, with `/` between names; for a shared entry, the deepest folder's.
    pub path: String,
    pub folder: bool,
}

/// What a folder holds, folders first, each in the order of VS Code's explorer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Directory {
    pub entries: Vec<TreeEntry>,
    /// Entries past the most a folder lists.
    pub more: u32,
    /// The repository has more files than the tree shows (`MAX_TREE_PATHS`).
    pub truncated: bool,
}

/// One file of the tree and its last change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    /// Milliseconds since the Unix epoch.
    pub modified: i64,
}

/// The files of a project's tree by their last change, newest first: the Files panel's Recent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFiles {
    pub files: Vec<RecentFile>,
    /// Older files past the most the list holds.
    pub more: u32,
    /// The project has more files than the tree holds (`MAX_TREE_PATHS`).
    pub truncated: bool,
}

/// A file's size and last change, for the viewer to show an image again once it changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: i64,
}

/// A file as the Files panel shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileContent {
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
    fn repository_changed_event_is_versioned() {
        assert_eq!(
            serde_json::to_value(RepositoryChangedEvent::new(
                "/r",
                RepositoryChange::anything("/r".into())
            ))
            .unwrap(),
            serde_json::json!({
                "version": 5,
                "folderId": "/r",
                "gitDir": true,
                "paths": null,
                "kindChanged": false
            })
        );
        let change = RepositoryChange {
            root: "/r".into(),
            git_dir: false,
            paths: Some(vec!["src/a.ts".into()]),
            kind_changed: false,
        };
        assert_eq!(
            serde_json::to_value(RepositoryChangedEvent::new("p", change)).unwrap(),
            serde_json::json!({
                "version": 5,
                "folderId": "p",
                "gitDir": false,
                "paths": ["src/a.ts"],
                "kindChanged": false
            })
        );
        assert_eq!(
            serde_json::to_value(RepositoryChangedEvent::new(
                "p",
                RepositoryChange::kind("/r".into())
            ))
            .unwrap()["kindChanged"],
            true
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
        let recent = RecentFiles {
            files: vec![RecentFile {
                path: "out/report.md".into(),
                modified: 1_793_000_000_000,
            }],
            more: 3,
            truncated: true,
        };
        assert_eq!(
            serde_json::to_value(recent).unwrap(),
            serde_json::json!({
                "files": [{ "path": "out/report.md", "modified": 1_793_000_000_000_i64 }],
                "more": 3,
                "truncated": true
            })
        );
    }
}
