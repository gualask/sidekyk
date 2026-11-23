//! The files of a folder as the Files panel shows them: what git lists in a repository, tracked
//! and untracked, or the walk of a folder without git, as folders; and what the rules hide, each
//! at the top of what it hides, dimmed, an ignored folder read from disk when opened.

mod ignored;
mod load;
mod recent;

use std::collections::HashMap;
use std::path::Path;

use super::contracts::{Directory, TreeEntry};
use super::name_order::compare_names;
use super::ports::RepositoryBackend;
use super::watch::git_path;

use ignored::{add_ignored, ignored_entries};
pub use ignored::{load_ignored_directory, IgnoredChanges};
pub use load::{load_file_tree, load_folder_tree};
pub use recent::load_recent_files;

/// A folder lists at most this many entries, folders first; the rest are counted.
const MAX_DIRECTORY_ENTRIES: usize = 10_000;

/// A name in a folder of the tree.
struct Child {
    name: String,
    /// Hidden by the rules: shown dimmed, and, for a folder, read from disk when opened.
    ignored: bool,
}

#[derive(Default)]
struct Folder {
    /// In the order the tree shows them.
    folders: Vec<Child>,
    files: Vec<Child>,
}

/// Every file git lists in a repository, tracked or untracked and not ignored, as folders, and
/// what git ignores at the top of what it ignores. A tracked file deleted from disk is left out,
/// as VS Code does: the Changes panel lists it.
pub struct FileTree {
    /// By path, `""` for the root; an ignored folder is not one of them.
    folders: HashMap<String, Folder>,
    /// Every file's path, sorted by its bytes: the palette searches them in this order. No ignored
    /// file: the palette, Recent and the searches leave them out.
    files: Vec<String>,
    /// What the rules hide, each at the top of what it hides, by path: whether it is a folder.
    ignored: HashMap<String, bool>,
    /// More files were listed than `MAX_TREE_PATHS`: the tree stops there.
    truncated: bool,
}

impl FileTree {
    /// The tree of these paths, relative to the root with `/` between names (the same path may
    /// come more than once: a conflict lists each stage), and of what the rules hide, as `git
    /// ls-files --ignored --directory` lists it: a folder ends in `/`, and a folder listed with
    /// entries under it holds files it does not hide, so it is not ignored itself. VCS folders and
    /// OS files never show.
    pub fn new<'a>(
        paths: impl IntoIterator<Item = &'a str>,
        ignored: impl IntoIterator<Item = &'a str>,
    ) -> Self {
        let mut files: Vec<String> = paths
            .into_iter()
            .filter(|path| !path.is_empty())
            .map(str::to_string)
            .collect();
        files.sort_unstable();
        files.dedup();
        let mut folders = folders_of(&files);
        let ignored = ignored_entries(ignored, &files, &folders);
        for (path, folder) in &ignored {
            add_ignored(&mut folders, path, *folder);
        }
        for folder in folders.values_mut() {
            sort_by_name(&mut folder.folders, |child| &child.name);
            sort_by_name(&mut folder.files, |child| &child.name);
        }
        Self {
            folders,
            files,
            ignored,
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

    /// The ignored entry that is `path` or holds it, and whether it is a folder.
    fn ignored_at<'p>(&self, path: &'p str) -> Option<(&'p str, bool)> {
        prefixes(path).find_map(|prefix| self.ignored.get(prefix).map(|&folder| (prefix, folder)))
    }

    /// Whether `path` is an ignored folder or inside one: what it holds is read from disk.
    pub fn in_ignored_folder(&self, path: &str) -> bool {
        self.ignored_at(path).is_some_and(|(_, folder)| folder)
    }

    /// Whether the Files panel may show the file at `path`: one of the tree, or one the rules
    /// hide, which the panel lists dimmed.
    pub fn shows_file(&self, path: &str) -> bool {
        self.contains_file(path) || self.ignored_at(path).is_some()
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
        let folders = folder.folders.iter().map(|child| {
            let at = child_path(path, &child.name);
            if child.ignored {
                TreeEntry::ignored(child.name.clone(), at, true)
            } else {
                self.folder_entry(&child.name, at)
            }
        });
        let files = folder.files.iter().map(|child| TreeEntry {
            name: child.name.clone(),
            path: child_path(path, &child.name),
            folder: false,
            ignored: child.ignored,
        });
        directory_of(folders, files, self.truncated)
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
            ignored: false,
        }
    }

    /// The name of the only thing in a folder, when it is a folder the rules do not hide: an
    /// ignored one keeps a row of its own, dimmed.
    fn only_folder_in(&self, path: &str) -> Option<&str> {
        let folder = self.folders.get(path)?;
        match (folder.folders.as_slice(), folder.files.is_empty()) {
            ([only], true) if !only.ignored => Some(&only.name),
            _ => None,
        }
    }
}

/// Names in the tree's order, VS Code's: case ignored, numbers by value.
fn sort_by_name<T>(items: &mut [T], name: impl Fn(&T) -> &str) {
    items.sort_by(|a, b| compare_names(name(a), name(b)));
}

/// What a folder lists: its folders, then its files, each already in the tree's order; at most
/// `MAX_DIRECTORY_ENTRIES`, the rest counted.
fn directory_of(
    folders: impl ExactSizeIterator<Item = TreeEntry>,
    files: impl ExactSizeIterator<Item = TreeEntry>,
    truncated: bool,
) -> Directory {
    let count = folders.len() + files.len();
    let entries: Vec<TreeEntry> = folders.chain(files).take(MAX_DIRECTORY_ENTRIES).collect();
    Directory {
        more: u32::try_from(count - entries.len()).unwrap_or(u32::MAX),
        entries,
        truncated,
    }
}

/// `path` and the folders above it, as paths, outermost first: `a`, `a/b`, `a/b/c`.
fn prefixes(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/')
        .map(|(at, _)| &path[..at])
        .chain(std::iter::once(path))
}

/// The folders holding `files`, `""` for the root, each with what it holds, not sorted yet.
fn folders_of(files: &[String]) -> HashMap<String, Folder> {
    let mut folders: HashMap<String, Folder> = HashMap::new();
    folders.insert(String::new(), Folder::default());
    // the folders a path brings, each with the folder above it, filled in once they exist
    let mut new_folders = Vec::new();
    for path in files {
        let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
        add_folders(&mut folders, &mut new_folders, parent);
        let parent = folders.get_mut(parent).expect("inserted above");
        parent.files.push(Child {
            name: name.to_string(),
            ignored: false,
        });
    }
    folders
}

/// The folder at `path` and each folder above it the tree does not have yet, each in the one
/// above it.
fn add_folders<'a>(
    folders: &mut HashMap<String, Folder>,
    new_folders: &mut Vec<(&'a str, &'a str)>,
    path: &'a str,
) {
    let mut folder = path;
    while !folders.contains_key(folder) {
        folders.insert(folder.to_string(), Folder::default());
        let (above, folder_name) = folder.rsplit_once('/').unwrap_or(("", folder));
        new_folders.push((above, folder_name));
        folder = above;
    }
    for (above, folder_name) in new_folders.drain(..) {
        let above = folders.get_mut(above).expect("inserted above");
        above.folders.push(Child {
            name: folder_name.to_string(),
            ignored: false,
        });
    }
}

/// The path of `name` in the folder at `folder`, `""` for the root.
fn child_path(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
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
        let tree = FileTree::new(
            [
                "README.md",
                "src/modules/changes/a.ts",
                "src/modules/changes/b.ts",
                "src/main.ts",
                "docs/deep/only/x.md",
                ".github/ci.yml",
            ],
            [],
        );
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
        let tree = FileTree::new(["src/a.ts", "src/gone.ts"], []);
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
        let tree = FileTree::new(["a/x.ts", "a/x.ts", "a/y.ts", "b.ts"], []);
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
        let tree = FileTree::new(paths.iter().map(String::as_str), []);
        let directory = tree.directory("");
        assert_eq!(directory.entries.len(), MAX_DIRECTORY_ENTRIES);
        assert_eq!(directory.more, 5);
    }
}
