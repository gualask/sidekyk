//! The files of a folder as the Files panel shows them: what git lists in a repository, tracked
//! and untracked, or the walk of a folder without git, as folders.

mod recent;

use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::contracts::{Directory, RepositoryInfo, TreeEntry};
use super::name_order::compare_names;
use super::open::existing_root;
use super::ports::{git_checked, joined, RepositoryBackend};
use super::reading::MAX_TREE_PATHS;
use super::watch::git_path;

pub use recent::load_recent_files;

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
pub struct FileTree {
    /// By path, `""` for the root.
    folders: HashMap<String, Folder>,
    /// Every file's path, sorted by its bytes: the palette searches them in this order.
    files: Vec<String>,
    /// More files were listed than `MAX_TREE_PATHS`: the tree stops there.
    truncated: bool,
}

impl FileTree {
    /// The tree of these paths, relative to the root with `/` between names. The same path may
    /// come more than once (a conflict lists each stage).
    pub fn from_paths<'a>(paths: impl IntoIterator<Item = &'a str>) -> Self {
        let mut files: Vec<String> = paths
            .into_iter()
            .filter(|path| !path.is_empty())
            .map(str::to_string)
            .collect();
        files.sort_unstable();
        files.dedup();
        Self {
            folders: folders_of(&files),
            files,
            truncated: false,
        }
    }

    /// The same tree, saying whether more files were listed than it holds.
    pub fn with_truncated(mut self, truncated: bool) -> Self {
        self.truncated = truncated;
        self
    }

    /// Every file's path, sorted by its bytes.
    pub fn files(&self) -> &[String] {
        &self.files
    }

    /// Whether more files were listed than the tree holds.
    pub fn truncated(&self) -> bool {
        self.truncated
    }

    pub fn contains_file(&self, path: &str) -> bool {
        self.files
            .binary_search_by(|file| file.as_str().cmp(path))
            .is_ok()
    }

    /// Whether the tree has this file or folder.
    pub fn contains(&self, path: &str) -> bool {
        self.contains_file(path) || self.folders.contains_key(path)
    }

    /// Whether these changed paths (relative to `root`, not ignored) may have added or removed a
    /// file: one on disk the tree does not have, or one the tree has that is gone. An edit to a
    /// file the tree has changes nothing.
    pub fn may_have_changed(
        &self,
        backend: &dyn RepositoryBackend,
        root: &Path,
        changed: &[&Path],
    ) -> bool {
        changed.iter().any(|rel| {
            let on_disk = backend.has_entry(root, rel);
            git_path(rel).is_none_or(|path| on_disk != self.contains(&path))
        })
    }

    /// What a folder holds, folders first. A folder holding only one folder shares its entry with
    /// it ("modules/changes"), down to a folder that holds files or several folders: opening the
    /// entry lists that one. A folder the tree does not have (deleted since) holds nothing.
    pub fn directory(&self, path: &str) -> Directory {
        let Some(folder) = self.folders.get(path) else {
            return Directory {
                entries: Vec::new(),
                more: 0,
                truncated: self.truncated,
            };
        };
        let count = folder.folders.len() + folder.files.len();
        let folders = folder
            .folders
            .iter()
            .map(|name| self.folder_entry(name, child_path(path, name)));
        let files = folder.files.iter().map(|name| TreeEntry {
            name: name.clone(),
            path: child_path(path, name),
            folder: false,
        });
        let entries: Vec<TreeEntry> = folders.chain(files).take(MAX_DIRECTORY_ENTRIES).collect();
        Directory {
            more: u32::try_from(count - entries.len()).unwrap_or(u32::MAX),
            entries,
            truncated: self.truncated,
        }
    }

    /// The entry of the folder `name` at `path`, shared with the folders down to one that holds
    /// files or several folders.
    fn folder_entry(&self, name: &str, mut path: String) -> TreeEntry {
        let mut label = name.to_string();
        while let Some(only) = self.only_folder_in(&path) {
            label = format!("{label}/{only}");
            path = format!("{path}/{only}");
        }
        TreeEntry {
            name: label,
            path,
            folder: true,
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

/// The folders holding `files`, `""` for the root, each with what it holds in the tree's order.
fn folders_of(files: &[String]) -> HashMap<String, Folder> {
    let mut folders: HashMap<String, Folder> = HashMap::new();
    folders.insert(String::new(), Folder::default());
    // the folders a path brings, each with the folder above it, filled in once they exist
    let mut new_folders = Vec::new();
    for path in files {
        add_file(&mut folders, &mut new_folders, path);
    }
    for folder in folders.values_mut() {
        folder.folders.sort_by(|a, b| compare_names(a, b));
        folder.files.sort_by(|a, b| compare_names(a, b));
    }
    folders
}

/// The file at `path` in its folder, and each folder it brings in the one above it.
fn add_file<'a>(
    folders: &mut HashMap<String, Folder>,
    new_folders: &mut Vec<(&'a str, &'a str)>,
    path: &'a str,
) {
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

/// The path of `name` in the folder at `folder`, `""` for the root.
fn child_path(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    }
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
pub fn load_file_tree(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<FileTree> {
    let root = existing_root(backend, repository)?;
    let ls_files = |args: &[&str]| ls_files(backend, root, args);
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
    let tree = FileTree::from_paths(present.by_ref().take(MAX_TREE_PATHS));
    Ok(tree.with_truncated(cut || present.next().is_some()))
}

/// The paths `git ls-files` with `args` lists, and whether the list was cut.
fn ls_files(
    backend: &dyn RepositoryBackend,
    root: &Path,
    args: &[&str],
) -> anyhow::Result<(Vec<String>, bool)> {
    let out = git_checked(backend, root, args, &[0], MAX_LS_FILES_BYTES)?;
    Ok((listed(&out.stdout, out.truncated), out.truncated))
}

/// The files of a folder without git, as the Files panel shows them: at most `MAX_TREE_PATHS`,
/// past them the tree says it stops.
pub fn load_folder_tree(backend: &dyn RepositoryBackend, root: &Path) -> FileTree {
    let walked = backend.walk(root, MAX_TREE_PATHS);
    FileTree::from_paths(walked.paths.iter().map(String::as_str)).with_truncated(walked.truncated)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::modules::folder::FakeBackend;

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
        assert_eq!(
            tree.files(),
            [
                ".github/ci.yml",
                "README.md",
                "docs/deep/only/x.md",
                "src/main.ts",
                "src/modules/changes/a.ts",
                "src/modules/changes/b.ts",
            ]
        );
    }

    /// What is on disk under the root, as relative paths.
    struct OnDisk(Mutex<HashSet<&'static str>>);

    impl FakeBackend for OnDisk {
        fn has_entry(&self, _root: &Path, path: &Path) -> bool {
            self.0.lock().unwrap().contains(path.to_str().unwrap())
        }
    }

    #[test]
    fn only_a_file_added_or_removed_changes_the_tree() {
        let disk = OnDisk(Mutex::new(HashSet::from(["src", "src/a.ts"])));
        let tree = FileTree::from_paths(["src/a.ts", "src/gone.ts"]);
        let changed = |rels: &[&'static str]| {
            let rels: Vec<&Path> = rels.iter().map(|rel| Path::new(*rel)).collect();
            tree.may_have_changed(&disk, Path::new("/r"), &rels)
        };

        assert!(!changed(&["src/a.ts", "src"]));
        assert!(changed(&["src/gone.ts"]));
        disk.0.lock().unwrap().insert("src/new.ts");
        assert!(changed(&["src/a.ts", "src/new.ts"]));
        // written and deleted again within the batch: nothing to show
        assert!(!changed(&["src/tmp.ts"]));
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
