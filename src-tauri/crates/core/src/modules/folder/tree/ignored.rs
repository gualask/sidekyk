//! What the rules hide, as the Files panel shows it: the entries at the top of what they hide,
//! from the list git or the walk gives; an ignored folder's entries read from disk when it is
//! opened, never kept; and which changes to ignored paths the panel shows.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::{
    add_folders, child_path, directory_of, prefixes, sort_by_name, Child, FileTree, Folder,
};
use crate::modules::folder::contracts::{Directory, RepositoryInfo, TreeEntry};
use crate::modules::folder::open::existing_root;
use crate::modules::folder::ports::RepositoryBackend;
use crate::modules::folder::watch::git_path;
use crate::modules::folder::{always_hidden, always_hidden_path, checked_path};

/// What the ignored folder at `path` (or a folder inside one) holds, read from disk now, all
/// ignored, folders first: a link is not followed, nor a folder reached through one; VCS folders
/// and OS files never show, nor a name that is not UTF-8. No folder shares its row with the one
/// inside it: that would read every folder listed.
pub fn load_ignored_directory(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    tree: &FileTree,
    path: &str,
) -> anyhow::Result<Directory> {
    let root = existing_root(backend, repository)?;
    let path = checked_path(path)?;
    let (mut folders, mut files): (Vec<TreeEntry>, Vec<TreeEntry>) = backend
        .entries(root, Path::new(path))
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| !always_hidden(entry.name.as_os_str()))
        .filter_map(|entry| {
            let name = entry.name.into_os_string().into_string().ok()?;
            let at = child_path(path, &name);
            Some(TreeEntry::ignored(name, at, entry.folder))
        })
        .partition(|entry| entry.folder);
    sort_by_name(&mut folders, |entry| &entry.name);
    sort_by_name(&mut files, |entry| &entry.name);
    Ok(directory_of(
        folders.into_iter(),
        files.into_iter(),
        tree.truncated(),
    ))
}

/// What the rules hide, as git lists it, by path, whether a folder: never what the tree has, a
/// VCS folder or an OS file, nor a folder listed with entries under it, which holds what it does
/// not hide.
pub(super) fn ignored_entries<'a>(
    listed: impl IntoIterator<Item = &'a str>,
    files: &[String],
    folders: &HashMap<String, Folder>,
) -> HashMap<String, bool> {
    let listed: Vec<(&str, bool)> = listed
        .into_iter()
        .map(|path| match path.strip_suffix('/') {
            Some(folder) => (folder, true),
            None => (path, false),
        })
        .filter(|(path, _)| !path.is_empty())
        .filter(|(path, _)| !always_hidden_path(Path::new(path)))
        .collect();
    let holding: HashSet<&str> = listed
        .iter()
        .flat_map(|(path, _)| prefixes(path).filter(move |prefix| prefix != path))
        .collect();
    listed
        .into_iter()
        .filter(|(path, _)| !holding.contains(path))
        .filter(|(path, _)| files.binary_search_by(|f| f.as_str().cmp(path)).is_err())
        .filter(|(path, _)| !folders.contains_key(*path))
        .map(|(path, folder)| (path.to_string(), folder))
        .collect()
}

/// The ignored entry at `path` in its folder, and each folder it brings in the one above it.
pub(super) fn add_ignored(folders: &mut HashMap<String, Folder>, path: &str, folder: bool) {
    let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
    let mut new_folders = Vec::new();
    add_folders(folders, &mut new_folders, parent);
    let child = Child {
        name: name.to_string(),
        ignored: true,
    };
    let parent = folders.get_mut(parent).expect("inserted above");
    if folder {
        parent.folders.push(child);
    } else {
        parent.files.push(child);
    }
}

/// What changes to ignored paths mean for the Files panel.
#[derive(Debug, Default, PartialEq)]
pub struct IgnoredChanges<'a> {
    /// An ignored entry came or went where the tree shows it: the tree is read again.
    pub tree: bool,
    /// Changed paths the panel shows: in an ignored folder it read (`opened`), or an ignored
    /// file in a folder that shows.
    pub shown: Vec<&'a Path>,
    /// Ignored folders the panel read that changed themselves (gone, or made again): watched
    /// again where the system watches one folder at a time.
    pub opened: Vec<&'a Path>,
}

impl FileTree {
    /// What these changed paths (relative to `root`, ignored) mean for the panel, given the
    /// ignored folders it read (`opened`). A change deep in an ignored folder nobody opened, such
    /// as a build writing `target/`, means nothing; the disk is asked only whether an entry at
    /// the top of what the rules hide is there.
    pub fn ignored_changes<'a>(
        &self,
        backend: &dyn RepositoryBackend,
        root: &Path,
        opened: &HashSet<String>,
        changed: &[&'a Path],
    ) -> IgnoredChanges<'a> {
        let mut changes = IgnoredChanges::default();
        for &rel in changed {
            if always_hidden_path(rel) {
                continue;
            }
            // a name that is not UTF-8 is never listed
            let Some(path) = git_path(rel) else { continue };
            if opened.contains(&path) {
                changes.opened.push(rel);
            }
            match self.ignored_change(backend, root, opened, &path) {
                IgnoredChange::Tree => changes.tree = true,
                IgnoredChange::Shown => changes.shown.push(rel),
                IgnoredChange::Unseen => {}
            }
        }
        changes
    }

    /// What a change to the ignored `path` means for the panel, by the first path down to it
    /// that is not a folder of the tree: the entry that shows of it.
    fn ignored_change(
        &self,
        backend: &dyn RepositoryBackend,
        root: &Path,
        opened: &HashSet<String>,
        path: &str,
    ) -> IgnoredChange {
        let Some(top) = prefixes(path).find(|prefix| !self.folders.contains_key(*prefix)) else {
            return IgnoredChange::Unseen;
        };
        let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
        let on_disk = |at: &str| backend.has_entry(root, Path::new(at));
        match self.ignored.get(top) {
            // an ignored entry gone
            Some(_) if top == path && !on_disk(path) => IgnoredChange::Tree,
            // an ignored file written, in a folder that shows
            Some(false) if top == path => IgnoredChange::Shown,
            Some(_) if top == path => IgnoredChange::Unseen,
            // inside an ignored folder: shown once the panel read the folder holding it
            Some(_) if opened.contains(parent) || opened.contains(path) => IgnoredChange::Shown,
            Some(_) => IgnoredChange::Unseen,
            // an ignored entry new where the tree shows
            None if !self.contains_file(top) && on_disk(top) => IgnoredChange::Tree,
            None => IgnoredChange::Unseen,
        }
    }
}

/// What a change to one ignored path means for the panel.
enum IgnoredChange {
    /// The tree is read again.
    Tree,
    /// The path shows: what lists or shows it is read again.
    Shown,
    /// Nothing the panel shows.
    Unseen,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;
    use crate::modules::folder::{FakeBackend, FolderEntry};

    /// What is on disk under the root, as relative paths, folders ending in `/`.
    struct OnDisk(Mutex<HashSet<&'static str>>);

    impl OnDisk {
        fn new(paths: &[&'static str]) -> Self {
            Self(Mutex::new(paths.iter().copied().collect()))
        }
    }

    impl FakeBackend for OnDisk {
        fn has_entry(&self, _root: &Path, path: &Path) -> bool {
            let path = path.to_str().unwrap();
            let disk = self.0.lock().unwrap();
            disk.contains(path) || disk.contains(format!("{path}/").as_str())
        }

        fn is_dir(&self, _path: &Path) -> bool {
            true
        }

        fn entries(&self, _root: &Path, path: &Path) -> Option<Vec<FolderEntry>> {
            let folder = format!("{}/", path.to_str().unwrap());
            let disk = self.0.lock().unwrap();
            Some(
                disk.iter()
                    .filter_map(|entry| entry.strip_prefix(folder.as_str()))
                    .filter(|rest| !rest.is_empty())
                    .filter(|rest| !rest.trim_end_matches('/').contains('/'))
                    .map(|rest| FolderEntry {
                        name: PathBuf::from(rest.trim_end_matches('/')),
                        folder: rest.ends_with('/'),
                    })
                    .collect(),
            )
        }
    }

    fn tree() -> FileTree {
        FileTree::new(
            ["src/a.ts", "README.md"],
            ["node_modules/", "debug.log", "src/gen/", "src/.DS_Store"],
        )
    }

    fn changes<'a>(disk: &OnDisk, opened: &[&str], changed: &'a [PathBuf]) -> IgnoredChanges<'a> {
        let opened = opened.iter().map(|path| path.to_string()).collect();
        let changed: Vec<&Path> = changed.iter().map(PathBuf::as_path).collect();
        tree().ignored_changes(disk, Path::new("/r"), &opened, &changed)
    }

    fn paths(paths: &[&str]) -> Vec<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn a_change_deep_in_an_ignored_folder_shows_only_once_its_folder_is_opened() {
        let disk = OnDisk::new(&[
            "node_modules/",
            "node_modules/react/",
            "node_modules/react/a.js",
        ]);
        let changed = paths(&["node_modules/react/a.js"]);
        assert_eq!(changes(&disk, &[], &changed), IgnoredChanges::default());
        assert_eq!(
            changes(&disk, &["node_modules", "node_modules/react"], &changed).shown,
            [Path::new("node_modules/react/a.js")]
        );
        // a folder added in an opened one shows too
        let changed = paths(&["node_modules/zod"]);
        assert_eq!(
            changes(&disk, &["node_modules"], &changed).shown,
            [Path::new("node_modules/zod")]
        );
    }

    #[test]
    fn an_ignored_entry_coming_or_going_where_the_tree_shows_reads_the_tree_again() {
        let disk = OnDisk::new(&["node_modules/", "dist/", "dist/app.js"]);
        // `dist/` is new, under the root
        assert!(changes(&disk, &[], &paths(&["dist/app.js"])).tree);
        // `debug.log` is gone
        assert!(changes(&disk, &[], &paths(&["debug.log"])).tree);
        // gone and back within the batch: nothing to read again
        assert!(!changes(&disk, &[], &paths(&["tmp.log"])).tree);
        // still there, written: the viewer reads it again, the tree stays
        let disk = OnDisk::new(&["debug.log"]);
        let changed = paths(&["debug.log"]);
        let written = changes(&disk, &[], &changed);
        assert!(!written.tree);
        assert_eq!(written.shown, [Path::new("debug.log")]);
    }

    #[test]
    fn vcs_folders_and_os_files_never_show() {
        let disk = OnDisk::new(&["src/.DS_Store", ".DS_Store"]);
        assert_eq!(
            changes(&disk, &["src/gen"], &paths(&[".DS_Store", "src/.DS_Store"])),
            IgnoredChanges::default()
        );
    }

    #[test]
    fn an_ignored_folder_is_read_from_disk_folders_first_all_ignored() {
        let disk = OnDisk::new(&[
            "node_modules/",
            "node_modules/zod/",
            "node_modules/.package-lock.json",
            "node_modules/react/",
            "node_modules/.DS_Store",
        ]);
        let info = RepositoryInfo {
            root: "/r".into(),
            name: "r".into(),
        };
        let directory = load_ignored_directory(&disk, &info, &tree(), "node_modules").unwrap();
        assert_eq!(
            directory.entries,
            [
                TreeEntry::ignored("react".into(), "node_modules/react".into(), true),
                TreeEntry::ignored("zod".into(), "node_modules/zod".into(), true),
                TreeEntry::ignored(
                    ".package-lock.json".into(),
                    "node_modules/.package-lock.json".into(),
                    false
                ),
            ]
        );
    }
}
