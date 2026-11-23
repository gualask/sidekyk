use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::modules::folder::holds_git;
use crate::modules::folder::ports::{nul_paths, RepositoryBackend};

/// The changes of a batch that show: git does not ignore them, or, in a folder without git, the
/// walk's rules do not hide them.
pub enum Visible<'a> {
    /// Every change counts: git could not answer, a change may alter what is hidden (an ignore
    /// file, the root itself), or the system dropped events.
    Unknown,
    /// These paths, relative to the root.
    Paths(Vec<&'a Path>),
}

impl Visible<'_> {
    pub fn any(&self) -> bool {
        match self {
            Self::Unknown => true,
            Self::Paths(paths) => !paths.is_empty(),
        }
    }

    /// The paths as git writes them, or `None` when any may count: unknown, more than `max`, or
    /// a name that is not UTF-8, which would not match git's.
    pub fn git_paths(&self, max: usize) -> Option<Vec<String>> {
        match self {
            Self::Paths(paths) if paths.len() <= max => {
                paths.iter().map(|path| git_path(path)).collect()
            }
            _ => None,
        }
    }
}

/// A batch's changes by whether they show.
pub struct Sorted<'a> {
    pub visible: Visible<'a>,
    /// Changed paths the rules hide, relative to the root: they show only where the Files panel
    /// shows them (`FileTree::ignored_changes`). None when `visible` is unknown.
    pub ignored: Vec<&'a Path>,
}

impl Sorted<'_> {
    /// Every change counts.
    pub fn unknown() -> Self {
        Self {
            visible: Visible::Unknown,
            ignored: Vec::new(),
        }
    }
}

/// Tells changes that can alter what Sidekyk shows from changes git ignores, such as a build
/// writing to `target/` or an install filling `node_modules/`, and from changes inside a
/// repository within this one (`is_inner_repository`).
///
/// Git answers (`git check-ignore`), so every rule applies exactly as in `git status`: nested
/// `.gitignore` files, `.git/info/exclude`, `core.excludesFile`, and tracked files inside an
/// ignored directory. Directories git ignores are remembered, so a burst of writes under one
/// costs a single question.
pub struct IgnoredPaths {
    root: PathBuf,
    /// Directories git ignores, relative to the root.
    ignored_dirs: HashSet<PathBuf>,
}

impl IgnoredPaths {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            ignored_dirs: HashSet::new(),
        }
    }

    /// Drops what was learned. Called when the rules or the index may have changed.
    pub fn forget(&mut self) {
        self.ignored_dirs.clear();
    }

    /// Which of these changed paths (absolute) git ignores and which it does not. When git cannot
    /// answer, every change counts: a needless refresh is better than a missed one.
    pub fn sort<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        changed: &'a [PathBuf],
    ) -> Sorted<'a> {
        let Some(Unsettled {
            candidates,
            ignored: mut known,
        }) = self.unsettled(backend, changed)
        else {
            return Sorted::unknown();
        };
        if candidates.is_empty() {
            return Sorted {
                visible: Visible::Paths(candidates),
                ignored: known,
            };
        }

        // Each path with its parent directories, so the next change under an ignored directory
        // is settled without asking git again.
        let asked: BTreeSet<&Path> = candidates
            .iter()
            .flat_map(|rel| rel.ancestors())
            .filter(|path| !path.as_os_str().is_empty())
            .collect();
        let Some(ignored) = check_ignore(backend, &self.root, &asked) else {
            return Sorted::unknown();
        };

        for dir in candidates.iter().flat_map(|rel| rel.ancestors().skip(1)) {
            if ignored.contains(dir) {
                self.ignored_dirs.insert(dir.to_path_buf());
            }
        }
        let (hidden, shown): (Vec<&Path>, Vec<&Path>) = candidates
            .into_iter()
            .partition(|rel| ignored.contains(*rel));
        known.extend(hidden);
        Sorted {
            visible: Visible::Paths(shown),
            ignored: known,
        }
    }

    /// The changed paths (absolute) that may be ones git does not ignore, and those it ignores
    /// for sure, from what was already learned: no git runs, so a path never asked about may show.
    pub fn guess<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        changed: &'a [PathBuf],
    ) -> Sorted<'a> {
        match self.unsettled(backend, changed) {
            None => Sorted::unknown(),
            Some(Unsettled {
                candidates,
                ignored,
            }) => Sorted {
                visible: Visible::Paths(candidates),
                ignored,
            },
        }
    }

    /// The changed paths, relative to the root, that are neither inside a directory known to be
    /// ignored nor inside another repository, and those inside a directory known to be ignored;
    /// `None` when one of them is visible for sure (outside the root, the root itself, a
    /// `.gitignore`).
    fn unsettled<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        changed: &'a [PathBuf],
    ) -> Option<Unsettled<'a>> {
        let mut inner = InnerRepositories::new(backend);
        let mut candidates = Vec::new();
        let mut ignored = Vec::new();
        for path in changed {
            let rel = path.strip_prefix(&self.root).ok()?;
            if rel.as_os_str().is_empty() {
                return None;
            }
            if changes_rules(rel) && !inner.holds(&self.root, rel) {
                self.forget();
                return None;
            }
            // what is known first: a burst under `node_modules/` asks nothing of the disk
            if self.is_in_ignored_dir(rel) {
                ignored.push(rel);
            } else if !inner.holds(&self.root, rel) {
                candidates.push(rel);
            }
        }
        Some(Unsettled {
            candidates,
            ignored,
        })
    }

    fn is_in_ignored_dir(&self, rel: &Path) -> bool {
        rel.ancestors().any(|path| self.ignored_dirs.contains(path))
    }
}

/// The changed paths `unsettled` leaves to git, and those it knows git ignores.
struct Unsettled<'a> {
    candidates: Vec<&'a Path>,
    ignored: Vec<&'a Path>,
}

/// Whether `folder` (relative to `root`) holds a repository inside this one: a submodule, a clone,
/// a linked worktree such as an agent's under `.claude/worktrees/`. Its files are not this
/// repository's: `git status` shows the folder at most, never what changes inside. The root
/// itself is this repository.
pub(in crate::modules::folder) fn is_inner_repository(
    backend: &dyn RepositoryBackend,
    root: &Path,
    folder: &Path,
) -> bool {
    !folder.as_os_str().is_empty() && holds_git(backend, root, folder)
}

/// The repositories inside the root met by a batch: a change inside one shows nothing, as on
/// Linux, where `folders.rs` does not watch them; the folder itself coming or going does.
struct InnerRepositories<'b, 'a> {
    backend: &'b dyn RepositoryBackend,
    /// Each folder met during one batch, whether it is or is inside another repository: the paths
    /// of a burst share their folders, so each is looked up once and asked of the disk once.
    known: HashMap<&'a Path, bool>,
}

impl<'b, 'a> InnerRepositories<'b, 'a> {
    fn new(backend: &'b dyn RepositoryBackend) -> Self {
        Self {
            backend,
            known: HashMap::new(),
        }
    }

    /// Whether `rel` (relative to `root`) is inside another repository.
    fn holds(&mut self, root: &Path, rel: &'a Path) -> bool {
        rel.parent()
            .is_some_and(|dir| self.in_repository(root, dir))
    }

    /// Whether `dir` is an inner repository, or inside one.
    fn in_repository(&mut self, root: &Path, dir: &'a Path) -> bool {
        if let Some(&known) = self.known.get(dir) {
            return known;
        }
        let inside = dir
            .parent()
            .is_some_and(|parent| self.in_repository(root, parent))
            || is_inner_repository(self.backend, root, dir);
        self.known.insert(dir, inside);
        inside
    }
}

/// Whether a change to `path` may change what git ignores: a `.gitignore`.
pub(in crate::modules::folder) fn changes_rules(path: &Path) -> bool {
    path.file_name().is_some_and(|name| name == ".gitignore")
}

/// A relative path as git writes it, with `/` on every platform. `None` when it is not UTF-8.
pub(in crate::modules::folder) fn git_path(path: &Path) -> Option<String> {
    let parts: Option<Vec<&str>> = path.components().map(|c| c.as_os_str().to_str()).collect();
    Some(parts?.join("/"))
}

/// The paths among `paths` (relative to `root`) that git ignores, or `None` when git fails. A
/// folder that holds tracked files is not ignored, whatever the rules say of it.
pub(in crate::modules::folder) fn check_ignore(
    backend: &dyn RepositoryBackend,
    root: &Path,
    paths: &BTreeSet<&Path>,
) -> Option<HashSet<PathBuf>> {
    let mut input = Vec::new();
    for path in paths {
        input.extend_from_slice(git_path(path)?.as_bytes());
        input.push(0);
    }
    // git answers with some of the paths it was given, so never more than them
    let out = backend
        .git_with_input(
            root,
            &["check-ignore", "-z", "--stdin"],
            &input,
            input.len(),
        )
        .ok()?;
    // 0: some paths are ignored, 1: none are.
    if out.truncated || (out.code != 0 && out.code != 1) {
        return None;
    }
    Some(nul_paths(&out.stdout).map(PathBuf::from).collect())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::modules::folder::{FakeBackend, GitOutput};

    /// Ignores `target/` and `*.log` and records every question; `repositories` hold a `.git`.
    #[derive(Default)]
    struct FakeGit {
        asked: Mutex<Vec<Vec<String>>>,
        fail: bool,
        repositories: Vec<&'static str>,
    }

    impl FakeBackend for FakeGit {
        fn has_entry(&self, _root: &Path, path: &Path) -> bool {
            path.file_name().is_some_and(|name| name == ".git")
                && self
                    .repositories
                    .iter()
                    .any(|repository| path.parent() == Some(Path::new(repository)))
        }

        fn git_with_input(
            &self,
            _cwd: &Path,
            _args: &[&str],
            input: &[u8],
            _max: usize,
        ) -> anyhow::Result<GitOutput> {
            let paths: Vec<String> = input
                .split(|&b| b == 0)
                .filter(|p| !p.is_empty())
                .map(|p| String::from_utf8(p.to_vec()).unwrap())
                .collect();
            let ignored: Vec<u8> = paths
                .iter()
                .filter(|p| *p == "target" || p.starts_with("target/") || p.ends_with(".log"))
                .flat_map(|p| p.bytes().chain([0]))
                .collect();
            self.asked.lock().unwrap().push(paths);
            Ok(GitOutput {
                code: if self.fail { 128 } else { 0 },
                stdout: ignored,
                stderr: String::new(),
                truncated: false,
            })
        }
    }

    fn paths(rels: &[&str]) -> Vec<PathBuf> {
        rels.iter().map(|rel| Path::new("/r").join(rel)).collect()
    }

    #[test]
    fn changes_under_an_ignored_directory_are_settled_once() {
        let git = FakeGit::default();
        let mut ignored = IgnoredPaths::new("/r".into());

        assert!(!ignored
            .sort(&git, &paths(&["target/debug/a.o", "src/app.log"]))
            .visible
            .any());
        assert!(!ignored
            .sort(&git, &paths(&["target/release/b.o"]))
            .visible
            .any());
        assert!(ignored
            .sort(&git, &paths(&["target/c.o", "src/main.rs"]))
            .visible
            .any());

        let asked = git.asked.lock().unwrap();
        assert_eq!(asked.len(), 2, "the second batch is answered from memory");
        assert_eq!(
            asked[0],
            [
                "src",
                "src/app.log",
                "target",
                "target/debug",
                "target/debug/a.o"
            ]
        );
        // a path under an ignored directory is settled from memory
        assert!(asked[1].contains(&"src/main.rs".to_string()), "{asked:?}");
        assert!(
            asked[1].iter().all(|path| !path.starts_with("target")),
            "{asked:?}"
        );
    }

    #[test]
    fn what_git_ignores_is_kept_apart_whether_asked_or_known() {
        let git = FakeGit::default();
        let mut ignored = IgnoredPaths::new("/r".into());
        let changed = paths(&["target/debug/a.o", "src/app.log", "src/main.rs"]);
        let sorted = ignored.sort(&git, &changed);
        assert_eq!(
            sorted.ignored,
            [Path::new("target/debug/a.o"), Path::new("src/app.log")]
        );
        let changed = paths(&["target/release/b.o"]);
        assert_eq!(
            ignored.guess(&git, &changed).ignored,
            [Path::new("target/release/b.o")]
        );
        assert_eq!(
            ignored.sort(&git, &changed).ignored,
            [Path::new("target/release/b.o")]
        );
    }

    #[test]
    fn a_gitignore_change_counts_and_forgets_what_was_learned() {
        let git = FakeGit::default();
        let mut ignored = IgnoredPaths::new("/r".into());
        assert!(!ignored.sort(&git, &paths(&["target/a.o"])).visible.any());

        assert!(ignored
            .sort(&git, &paths(&["sub/.gitignore"]))
            .visible
            .any());
        assert!(!ignored.sort(&git, &paths(&["target/a.o"])).visible.any());
        assert_eq!(git.asked.lock().unwrap().len(), 2);
    }

    #[test]
    fn without_git_only_directories_already_learned_are_settled() {
        let git = FakeGit::default();
        let mut ignored = IgnoredPaths::new("/r".into());
        assert!(ignored.guess(&git, &paths(&["target/a.o"])).visible.any());

        assert!(!ignored.sort(&git, &paths(&["target/a.o"])).visible.any());
        assert!(!ignored
            .guess(&git, &paths(&["target/debug/b.o"]))
            .visible
            .any());
        assert!(ignored
            .guess(&git, &paths(&["target/c.o", "dist/app.js"]))
            .visible
            .any());
        assert!(ignored.guess(&git, &paths(&[".gitignore"])).visible.any());
        assert!(
            ignored.guess(&git, &paths(&["target/a.o"])).visible.any(),
            "forgotten"
        );
        assert_eq!(git.asked.lock().unwrap().len(), 1);
    }

    #[test]
    fn changes_inside_another_repository_show_nothing_and_ask_nothing() {
        // an agent's worktree under the root, not ignored
        let git = FakeGit {
            repositories: vec![".claude/worktrees/feat"],
            ..FakeGit::default()
        };
        let mut ignored = IgnoredPaths::new("/r".into());
        let inside = paths(&[
            ".claude/worktrees/feat/src/a.ts",
            ".claude/worktrees/feat/.gitignore",
        ]);
        assert!(!ignored.sort(&git, &inside).visible.any());
        assert!(!ignored.guess(&git, &inside).visible.any());
        assert!(git.asked.lock().unwrap().is_empty());

        // the worktree coming or going changes the status; so does the repository's own file
        let outside = paths(&[".claude/worktrees/feat", "src/main.rs"]);
        let Visible::Paths(shown) = ignored.sort(&git, &outside).visible else {
            panic!("git answered");
        };
        assert_eq!(
            shown,
            [
                Path::new(".claude/worktrees/feat"),
                Path::new("src/main.rs")
            ]
        );
    }

    #[test]
    fn when_git_cannot_answer_the_change_counts() {
        let git = FakeGit {
            fail: true,
            ..FakeGit::default()
        };
        let mut ignored = IgnoredPaths::new("/r".into());
        assert!(ignored.sort(&git, &paths(&["target/a.o"])).visible.any());
        assert!(ignored
            .sort(&git, &[PathBuf::from("/elsewhere/a.ts")])
            .visible
            .any());
    }

    #[test]
    fn visible_paths_go_as_git_writes_them_unless_too_many() {
        let paths = [Path::new("src").join("cart.ts"), PathBuf::from("README.md")];
        let visible = Visible::Paths(paths.iter().map(PathBuf::as_path).collect());
        assert_eq!(
            visible.git_paths(2),
            Some(vec!["src/cart.ts".to_string(), "README.md".to_string()])
        );
        assert_eq!(visible.git_paths(1), None);
        assert_eq!(Visible::Unknown.git_paths(2), None);
    }
}
