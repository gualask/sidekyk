//! The files of a folder without git, by ripgrep's walker (`ignore`): the walk lists them, the
//! rules answer for one path at a time, both from the same settings so they never disagree. What
//! the rules hide is what each folder walked holds that the walk left out.

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use ignore::{DirEntry, IncrementalIgnore, WalkBuilder, WalkState};

use crate::modules::folder::{always_hidden, always_hidden_path, FolderRules, Walked};
use crate::shared::sync::lock;
use crate::shared::threads::threads;

/// `.gitignore` and `.ignore` files in the folder and below, git's global excludes; nothing above
/// the folder, no `.git/info/exclude` (a folder without git has none). Hidden files are listed,
/// links listed and not followed.
fn walker(root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(root);
    builder
        .require_git(false)
        .hidden(false)
        .git_ignore(true)
        .ignore(true)
        .git_global(true)
        .git_exclude(false)
        .parents(false)
        .follow_links(false);
    builder
}

/// `RepositoryBackend::walk`: in parallel, stopped once `max` files are found, so past it which
/// files are kept may differ from one walk to the next. Each folder walked is also read on its
/// own: what it holds that the walk did not enter or list is what the rules hide.
pub fn walk(root: &Path, max: usize) -> Walked {
    let found = Found::new(max);
    walker(root)
        .threads(threads())
        .filter_entry(|entry| !always_hidden(entry.file_name()))
        .build_parallel()
        .run(|| Box::new(|entry| found.visit(root, entry)));
    found.into_walked()
}

/// A folder the walk entered, relative to the root, with what it holds: each name, and whether
/// it is a folder.
struct Entered {
    folder: String,
    held: Vec<(OsString, bool)>,
}

/// The files a parallel walk finds, from each of its threads, up to `max`, and the folders it
/// enters.
struct Found {
    max: usize,
    paths: Mutex<Vec<String>>,
    folders: Mutex<Vec<Entered>>,
    found: AtomicUsize,
    truncated: AtomicBool,
}

impl Found {
    fn new(max: usize) -> Self {
        Self {
            max,
            paths: Mutex::new(Vec::new()),
            folders: Mutex::new(Vec::new()),
            found: AtomicUsize::new(0),
            truncated: AtomicBool::new(false),
        }
    }

    /// Keeps `entry` if it is a file, relative to `root`, or what it holds if it is a folder; the
    /// walk quits past `max`.
    fn visit(&self, root: &Path, entry: Result<DirEntry, ignore::Error>) -> WalkState {
        let Ok(entry) = entry else {
            return WalkState::Continue;
        };
        // a link is listed as a file, whatever it points to
        if entry.file_type().is_none_or(|kind| kind.is_dir()) {
            self.enter(root, entry.path());
            return WalkState::Continue;
        }
        if self.found.fetch_add(1, Ordering::Relaxed) >= self.max {
            self.truncated.store(true, Ordering::Relaxed);
            return WalkState::Quit;
        }
        if let Ok(path) = entry.path().strip_prefix(root) {
            lock(&self.paths).push(slash_path(path));
        }
        WalkState::Continue
    }

    /// Keeps what the folder at `path` holds, as the walk will find it or leave it out.
    fn enter(&self, root: &Path, path: &Path) {
        let (Ok(rel), Ok(read)) = (path.strip_prefix(root), std::fs::read_dir(path)) else {
            return;
        };
        let held = read
            .filter_map(Result::ok)
            .map(|entry| {
                let folder = entry.file_type().is_ok_and(|kind| kind.is_dir());
                (entry.file_name(), folder)
            })
            .collect();
        lock(&self.folders).push(Entered {
            folder: slash_path(rel),
            held,
        });
    }

    fn into_walked(self) -> Walked {
        let paths = self.paths.into_inner().unwrap_or_else(|e| e.into_inner());
        let folders = self.folders.into_inner().unwrap_or_else(|e| e.into_inner());
        let truncated = self.truncated.into_inner();
        // past `max` the walk left out what it did not reach, not only what the rules hide
        let ignored = if truncated {
            Vec::new()
        } else {
            left_out(&paths, &folders)
        };
        Walked {
            paths,
            ignored,
            truncated,
        }
    }
}

/// What the folders entered hold that the walk neither entered nor listed, `folder::always_hidden`
/// aside, as git lists what it ignores: a folder ends in `/`.
fn left_out(paths: &[String], folders: &[Entered]) -> Vec<String> {
    let walked: HashSet<&str> = paths
        .iter()
        .chain(folders.iter().map(|entered| &entered.folder))
        .map(String::as_str)
        .collect();
    folders
        .iter()
        .flat_map(|entered| entered.held.iter().map(move |held| (entered, held)))
        .filter(|(_, (name, _))| !always_hidden(name))
        .map(|(entered, (name, is_folder))| (entered.path_of(name), *is_folder))
        .filter(|(path, _)| !walked.contains(path.as_str()))
        .map(|(path, is_folder)| if is_folder { format!("{path}/") } else { path })
        .collect()
}

impl Entered {
    /// The path of `name` in this folder, relative to the root with `/` between names.
    fn path_of(&self, name: &OsStr) -> String {
        let name = name.to_string_lossy();
        if self.folder.is_empty() {
            name.into_owned()
        } else {
            format!("{}/{name}", self.folder)
        }
    }
}

/// `RepositoryBackend::folder_rules`.
pub fn rules(root: &Path) -> Box<dyn FolderRules> {
    let matcher = walker(root)
        .build_matchers()
        .pop()
        .expect("one matcher per root");
    Box::new(LocalFolderRules(matcher))
}

/// The files the rules are read from, as `walker` sets them.
const RULES_FILES: [&str; 2] = [".gitignore", ".ignore"];

struct LocalFolderRules(IncrementalIgnore);

impl FolderRules for LocalFolderRules {
    fn is_hidden(&mut self, path: &Path) -> bool {
        // the walk's `filter_entry`, which the matcher does not apply
        if always_hidden_path(path) {
            return true;
        }
        // a link is a file, as the walk lists it
        let is_dir =
            std::fs::symlink_metadata(self.0.root().join(path)).is_ok_and(|meta| meta.is_dir());
        self.0.matched(path, is_dir).is_ignore()
    }

    fn is_rules_file(&self, path: &Path) -> bool {
        path.file_name()
            .is_some_and(|name| RULES_FILES.iter().any(|file| name == *file))
    }
}

/// A relative path with `/` between names, as git writes them; a name that is not UTF-8 as
/// `git ls-files` lists it for the Files panel.
fn slash_path(path: &Path) -> String {
    let names: Vec<_> = path
        .components()
        .filter_map(|name| match name {
            Component::Normal(name) => Some(name.to_string_lossy()),
            _ => None,
        })
        .collect();
    names.join("/")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    fn write(root: &Path, path: &str, text: &str) {
        let path = root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn listed(root: &Path, max: usize) -> (BTreeSet<String>, bool) {
        let walked = walk(root, max);
        (walked.paths.into_iter().collect(), walked.truncated)
    }

    fn left_out_by(root: &Path, max: usize) -> BTreeSet<String> {
        walk(root, max).ignored.into_iter().collect()
    }

    /// Names a user's global excludes are unlikely to hide.
    fn sample(root: &Path) {
        write(root, ".gitignore", "*.log\nbuild/\n");
        write(root, ".ignore", "!kept.log\n");
        write(root, "readme.md", "");
        write(root, "dropped.log", "");
        write(root, "kept.log", "");
        write(root, "build/out.js", "");
        write(root, "src/main.rs", "");
        write(root, "src/.gitignore", "!local.log\nsecret.txt\n");
        write(root, "src/local.log", "");
        write(root, "src/secret.txt", "");
        write(root, "src/deep/.ignore", "*.tmp\n");
        write(root, "src/deep/note.tmp", "");
        write(root, "src/deep/note.md", "");
        write(root, ".sidekyk-test/config", "");
        write(root, ".git/HEAD", "");
        write(root, "vendor/.hg/store", "");
        write(root, "vendor/.DS_Store", "");
        write(root, "vendor/lib.c", "");
    }

    #[test]
    fn ignore_files_hide_with_their_precedence_and_hidden_files_show() {
        let dir = tempfile::tempdir().unwrap();
        sample(dir.path());
        let (paths, truncated) = listed(dir.path(), 100);
        assert!(!truncated);
        let expected = [
            ".gitignore",
            ".ignore",
            ".sidekyk-test/config",
            "kept.log",
            "readme.md",
            "src/.gitignore",
            "src/deep/.ignore",
            "src/deep/note.md",
            "src/local.log",
            "src/main.rs",
            "vendor/lib.c",
        ];
        assert_eq!(paths, expected.iter().map(|p| p.to_string()).collect());
    }

    #[test]
    fn what_the_rules_hide_is_listed_at_its_top_as_git_lists_it() {
        let dir = tempfile::tempdir().unwrap();
        sample(dir.path());
        let expected = [
            "build/",
            "dropped.log",
            "src/deep/note.tmp",
            "src/secret.txt",
        ];
        assert_eq!(
            left_out_by(dir.path(), 100),
            expected.iter().map(|p| p.to_string()).collect()
        );
        // a walk cut short leaves out more than the rules hide: nothing is told
        assert!(left_out_by(dir.path(), 2).is_empty());
    }

    #[test]
    fn the_walk_stops_at_its_limit() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..10 {
            write(dir.path(), &format!("f{i}.txt"), "");
        }
        let (paths, truncated) = listed(dir.path(), 4);
        assert_eq!(paths.len(), 4);
        assert!(truncated);
        let (paths, truncated) = listed(dir.path(), 10);
        assert_eq!(paths.len(), 10);
        assert!(!truncated);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_listed_and_not_followed() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "src/main.rs", "");
        std::os::unix::fs::symlink(dir.path().join("src"), dir.path().join("link")).unwrap();
        let (paths, _) = listed(dir.path(), 100);
        assert_eq!(
            paths,
            ["link", "src/main.rs"]
                .iter()
                .map(|p| p.to_string())
                .collect()
        );
    }

    /// Every file on disk under `folder`, relative to `root`; links not followed.
    fn files_on_disk(root: &Path, folder: &Path, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(root.join(folder)).unwrap() {
            let entry = entry.unwrap();
            let path = folder.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                files_on_disk(root, &path, out);
            } else {
                out.push(path);
            }
        }
    }

    #[test]
    fn the_rules_hide_exactly_what_the_walk_leaves_out() {
        let dir = tempfile::tempdir().unwrap();
        sample(dir.path());
        let (walked, _) = listed(dir.path(), 100);
        let mut rules = rules(dir.path());
        let mut files = Vec::new();
        files_on_disk(dir.path(), Path::new(""), &mut files);
        for path in files {
            assert_eq!(
                rules.is_hidden(&path),
                !walked.contains(&slash_path(&path)),
                "{}",
                path.display()
            );
        }
        assert!(rules.is_hidden(Path::new("build")));
        assert!(rules.is_hidden(Path::new("build/new.js")));
        assert!(rules.is_hidden(Path::new("vendor/.hg")));
        assert!(!rules.is_hidden(Path::new("src/new.rs")));
        assert!(rules.is_rules_file(Path::new("src/.gitignore")));
        assert!(rules.is_rules_file(Path::new(".ignore")));
        assert!(!rules.is_rules_file(Path::new("src/main.rs")));
    }
}
