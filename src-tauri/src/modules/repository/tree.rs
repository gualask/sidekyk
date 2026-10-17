//! The files of a repository as the Files panel shows them: what git lists, tracked and untracked,
//! as folders, and the text of one of them.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::contracts::{Directory, FileContent, RepositoryInfo, TreeEntry};
use super::diff::{checked_path, cut_at_line};
use super::ignored::git_path;
use super::limits::{MAX_FILE_BYTES, MAX_TREE_PATHS};
use super::numstat::looks_binary;
use super::open::existing_root;
use super::ports::{git_checked, joined, RepositoryBackend, WorktreeEntry};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// Output read from `git ls-files`, well past what `MAX_TREE_PATHS` paths take.
const MAX_LS_FILES_BYTES: usize = 32 * 1024 * 1024;

/// A folder lists at most this many entries, folders first; the rest are counted.
const MAX_DIRECTORY_ENTRIES: usize = 10_000;

#[derive(Default)]
struct Folder {
    /// Names, in the order the tree shows them.
    folders: Vec<String>,
    files: Vec<String>,
}

/// Every file git lists in a repository, tracked or untracked and not ignored, as folders. A
/// tracked file deleted from disk is left out, as VS Code does: the Changes panel lists it.
pub(crate) struct FileTree {
    /// By path, `""` for the root.
    folders: HashMap<String, Folder>,
    files: HashSet<String>,
    /// git listed more files than `MAX_TREE_PATHS`: the tree stops there.
    truncated: bool,
}

impl FileTree {
    /// The tree of these paths, relative to the root with `/` between names. The same path may
    /// come more than once (a conflict lists each stage).
    pub(crate) fn from_paths<'a>(paths: impl IntoIterator<Item = &'a str>) -> Self {
        let mut folders: HashMap<String, Folder> = HashMap::new();
        folders.insert(String::new(), Folder::default());
        let mut files = HashSet::new();
        // the folders a path brings, each with the folder above it, filled in once they exist
        let mut new_folders = Vec::new();
        for path in paths {
            if path.is_empty() || !files.insert(path.to_string()) {
                continue;
            }
            let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
            let mut folder = parent;
            while !folders.contains_key(folder) {
                folders.insert(folder.to_string(), Folder::default());
                let (above, folder_name) = folder.rsplit_once('/').unwrap_or(("", folder));
                new_folders.push((above, folder_name));
                folder = above;
            }
            for (above, folder_name) in new_folders.drain(..) {
                let above = folders.get_mut(above).expect("inserted above");
                above.folders.push(folder_name.to_string());
            }
            let parent = folders.get_mut(parent).expect("inserted above");
            parent.files.push(name.to_string());
        }
        for folder in folders.values_mut() {
            folder.folders.sort_by(|a, b| compare_names(a, b));
            folder.files.sort_by(|a, b| compare_names(a, b));
        }
        Self {
            folders,
            files,
            truncated: false,
        }
    }

    pub(crate) fn contains_file(&self, path: &str) -> bool {
        self.files.contains(path)
    }

    /// Whether the tree has this file or folder.
    pub(crate) fn contains(&self, path: &str) -> bool {
        self.files.contains(path) || self.folders.contains_key(path)
    }

    /// Whether these changed paths (relative to `root`, not ignored) may have added or removed a
    /// file: one on disk the tree does not have, or one the tree has that is gone. An edit to a
    /// file the tree has changes nothing.
    pub(crate) fn may_have_changed(&self, root: &Path, changed: &[&Path]) -> bool {
        changed.iter().any(|rel| {
            let on_disk = std::fs::symlink_metadata(root.join(rel)).is_ok();
            git_path(rel).is_none_or(|path| on_disk != self.contains(&path))
        })
    }

    /// What a folder holds, folders first. A folder holding only one folder shares its entry with
    /// it ("modules/changes"), down to a folder that holds files or several folders: opening the
    /// entry lists that one. A folder the tree does not have (deleted since) holds nothing.
    pub(crate) fn directory(&self, path: &str) -> Directory {
        let Some(folder) = self.folders.get(path) else {
            return Directory {
                entries: Vec::new(),
                more: 0,
                truncated: self.truncated,
            };
        };
        let child = |name: &str| {
            if path.is_empty() {
                name.to_string()
            } else {
                format!("{path}/{name}")
            }
        };
        let count = folder.folders.len() + folder.files.len();
        let folders = folder.folders.iter().map(|name| {
            let mut label = name.clone();
            let mut path = child(name);
            while let Some(only) = self.only_folder_in(&path) {
                label = format!("{label}/{only}");
                path = format!("{path}/{only}");
            }
            TreeEntry {
                name: label,
                path,
                folder: true,
            }
        });
        let files = folder.files.iter().map(|name| TreeEntry {
            name: name.clone(),
            path: child(name),
            folder: false,
        });
        let entries: Vec<TreeEntry> = folders.chain(files).take(MAX_DIRECTORY_ENTRIES).collect();
        Directory {
            more: u32::try_from(count - entries.len()).unwrap_or(u32::MAX),
            entries,
            truncated: self.truncated,
        }
    }

    /// The name of the only thing in a folder, when it is a folder.
    fn only_folder_in(&self, path: &str) -> Option<&str> {
        let folder = self.folders.get(path)?;
        match (folder.folders.as_slice(), folder.files.is_empty()) {
            ([only], true) => Some(only),
            _ => None,
        }
    }
}

/// The order of names in a folder, as VS Code's explorer: letters ignoring case, numbers by
/// value ("file2" before "file10"), then the exact text, so the order is total.
fn compare_names(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a, b);
    loop {
        match (x.chars().next(), y.chars().next()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(cx), Some(cy)) if cx.is_ascii_digit() && cy.is_ascii_digit() => {
                let (nx, rest_x) = split_digits(x);
                let (ny, rest_y) = split_digits(y);
                let (vx, vy) = (nx.trim_start_matches('0'), ny.trim_start_matches('0'));
                let by_value = vx.len().cmp(&vy.len()).then_with(|| vx.cmp(vy));
                if by_value != Ordering::Equal {
                    return by_value;
                }
                (x, y) = (rest_x, rest_y);
            }
            (Some(cx), Some(cy)) => {
                let by_letter = cx.to_lowercase().cmp(cy.to_lowercase());
                if by_letter != Ordering::Equal {
                    return by_letter;
                }
                (x, y) = (&x[cx.len_utf8()..], &y[cy.len_utf8()..]);
            }
        }
    }
}

fn split_digits(text: &str) -> (&str, &str) {
    let end = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    text.split_at(end)
}

/// The paths of a NUL-separated list, without the last when the list was cut in it.
fn listed(bytes: &[u8], truncated: bool) -> Vec<String> {
    let mut paths: Vec<String> = bytes
        .split(|&b| b == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect();
    if truncated {
        paths.pop();
    }
    paths
}

/// Reads the files git lists: tracked and untracked ones not ignored, as `git status` sees them,
/// without the tracked files deleted from disk.
pub(crate) fn load_file_tree(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<FileTree> {
    let root = existing_root(repository)?;
    let ls_files = |args: &[&str]| -> anyhow::Result<(Vec<String>, bool)> {
        let out = git_checked(backend, root, args, &[0], MAX_LS_FILES_BYTES)?;
        Ok((listed(&out.stdout, out.truncated), out.truncated))
    };
    let (all, deleted) = std::thread::scope(|scope| {
        let deleted = scope.spawn(|| ls_files(&["ls-files", "-z", "--deleted"]));
        let all = ls_files(&[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ]);
        (all, joined(deleted))
    });
    let (paths, cut) = all?;
    let (deleted, _) = deleted?;
    let deleted: HashSet<&str> = deleted.iter().map(String::as_str).collect();
    let mut present = paths
        .iter()
        .map(String::as_str)
        .filter(|path| !deleted.contains(path));
    let mut tree = FileTree::from_paths(present.by_ref().take(MAX_TREE_PATHS));
    tree.truncated = cut || present.next().is_some();
    Ok(tree)
}

/// One file of a repository as the Files panel shows it: its text, or what it is instead. A link
/// is never followed, so nothing outside the repository is read through one.
pub(crate) fn load_file_content(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    path: &str,
) -> anyhow::Result<FileContent> {
    let root = existing_root(repository)?;
    let path = checked_path(path)?;
    let entry = backend
        .read_entry(root, Path::new(path), MAX_FILE_BYTES)
        .ok_or_else(|| user_facing(UserFacingErrorCode::FileMissing))?;
    Ok(match entry {
        WorktreeEntry::File { head, truncated } => {
            if looks_binary(&head) {
                FileContent::Binary
            } else {
                let head = if truncated { cut_at_line(head) } else { head };
                FileContent::Text {
                    text: String::from_utf8_lossy(&head).into_owned(),
                    truncated,
                }
            }
        }
        WorktreeEntry::Link(target) => FileContent::Link {
            target: link_target(&target),
        },
        WorktreeEntry::Folder => FileContent::Folder,
    })
}

/// A link's target as git stores it, with `/` between names.
fn link_target(target: &Path) -> String {
    let text = target.to_string_lossy();
    if cfg!(windows) {
        text.replace('\\', "/")
    } else {
        text.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(directory: &Directory) -> Vec<(&str, &str, bool)> {
        directory
            .entries
            .iter()
            .map(|e| (e.name.as_str(), e.path.as_str(), e.folder))
            .collect()
    }

    #[test]
    fn folders_come_first_and_a_lone_folder_shares_its_entry() {
        let tree = FileTree::from_paths([
            "README.md",
            "src/modules/changes/a.ts",
            "src/modules/changes/b.ts",
            "src/main.ts",
            "docs/deep/only/x.md",
            ".github/ci.yml",
        ]);
        assert_eq!(
            names(&tree.directory("")),
            [
                (".github", ".github", true),
                ("docs/deep/only", "docs/deep/only", true),
                ("src", "src", true),
                ("README.md", "README.md", false),
            ]
        );
        assert_eq!(
            names(&tree.directory("src")),
            [
                ("modules/changes", "src/modules/changes", true),
                ("main.ts", "src/main.ts", false),
            ]
        );
        assert_eq!(
            names(&tree.directory("docs/deep/only")),
            [("x.md", "docs/deep/only/x.md", false)]
        );
        assert!(tree.directory("gone").entries.is_empty());
        assert!(tree.contains_file("src/main.ts"));
        assert!(!tree.contains_file("src"));
        assert!(tree.contains("src/modules"));
    }

    #[test]
    fn only_a_file_added_or_removed_changes_the_tree() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.ts"), "").unwrap();
        let tree = FileTree::from_paths(["src/a.ts", "src/gone.ts"]);
        fn changed(rels: &[&'static str]) -> Vec<&'static Path> {
            rels.iter().map(|rel| Path::new(*rel)).collect()
        }

        assert!(!tree.may_have_changed(root, &changed(&["src/a.ts", "src"])));
        assert!(tree.may_have_changed(root, &changed(&["src/gone.ts"])));
        std::fs::write(root.join("src/new.ts"), "").unwrap();
        assert!(tree.may_have_changed(root, &changed(&["src/a.ts", "src/new.ts"])));
        // written and deleted again within the batch: nothing to show
        assert!(!tree.may_have_changed(root, &changed(&["src/tmp.ts"])));
    }

    #[test]
    fn a_path_listed_twice_shows_once() {
        let tree = FileTree::from_paths(["a/x.ts", "a/x.ts", "a/y.ts", "b.ts"]);
        assert_eq!(
            names(&tree.directory("a")),
            [("x.ts", "a/x.ts", false), ("y.ts", "a/y.ts", false)]
        );
        assert_eq!(names(&tree.directory("")).len(), 2);
    }

    #[test]
    fn names_sort_ignoring_case_and_numbers_by_value() {
        let mut names = vec!["b.ts", "file10", "A.ts", "file2", "a.ts", "file02", "_x"];
        names.sort_by(|a, b| compare_names(a, b));
        assert_eq!(
            names,
            ["_x", "A.ts", "a.ts", "b.ts", "file02", "file2", "file10"]
        );
    }

    #[test]
    fn a_large_folder_lists_its_first_entries_and_counts_the_rest() {
        let paths: Vec<String> = (0..MAX_DIRECTORY_ENTRIES + 5)
            .map(|i| format!("f{i}"))
            .collect();
        let tree = FileTree::from_paths(paths.iter().map(String::as_str));
        let directory = tree.directory("");
        assert_eq!(directory.entries.len(), MAX_DIRECTORY_ENTRIES);
        assert_eq!(directory.more, 5);
    }

    #[test]
    fn a_cut_list_drops_its_last_path() {
        assert_eq!(listed(b"a\0b\0c", true), ["a", "b"]);
        assert_eq!(listed(b"a\0b\0", false), ["a", "b"]);
    }
}
