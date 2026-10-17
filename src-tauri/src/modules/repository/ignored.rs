use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};

use super::ports::RepositoryBackend;

/// The changes of a batch that git does not ignore.
pub(crate) enum Visible<'a> {
    /// Every change counts: git could not answer, or a change may alter what it ignores (a
    /// `.gitignore`, the root itself).
    Unknown,
    /// These paths, relative to the root.
    Paths(Vec<&'a Path>),
}

impl Visible<'_> {
    pub(crate) fn any(&self) -> bool {
        match self {
            Self::Unknown => true,
            Self::Paths(paths) => !paths.is_empty(),
        }
    }
}

/// Tells changes that can alter what Sidekyk shows from changes git ignores, such as a build
/// writing to `target/` or an install filling `node_modules/`.
///
/// Git answers (`git check-ignore`), so every rule applies exactly as in `git status`: nested
/// `.gitignore` files, `.git/info/exclude`, `core.excludesFile`, and tracked files inside an
/// ignored directory. Directories git ignores are remembered, so a burst of writes under one
/// costs a single question.
pub(crate) struct IgnoredPaths {
    root: PathBuf,
    /// Directories git ignores, relative to the root.
    ignored_dirs: HashSet<PathBuf>,
}

impl IgnoredPaths {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            ignored_dirs: HashSet::new(),
        }
    }

    /// Drops what was learned. Called when the rules or the index may have changed.
    pub(crate) fn forget(&mut self) {
        self.ignored_dirs.clear();
    }

    /// Which of these changed paths (absolute) git does not ignore. When git cannot answer, every
    /// change counts: a needless refresh is better than a missed one.
    pub(crate) fn visible<'a>(
        &mut self,
        backend: &dyn RepositoryBackend,
        changed: &'a [PathBuf],
    ) -> Visible<'a> {
        let Some(candidates) = self.unsettled(changed) else {
            return Visible::Unknown;
        };
        if candidates.is_empty() {
            return Visible::Paths(candidates);
        }

        // Each path with its parent directories, so the next change under an ignored directory
        // is settled without asking git again.
        let asked: BTreeSet<&Path> = candidates
            .iter()
            .flat_map(|rel| rel.ancestors())
            .filter(|path| !path.as_os_str().is_empty())
            .collect();
        let Some(ignored) = check_ignore(backend, &self.root, &asked) else {
            return Visible::Unknown;
        };

        for rel in &candidates {
            for dir in rel.ancestors().skip(1) {
                if ignored.contains(dir) {
                    self.ignored_dirs.insert(dir.to_path_buf());
                }
            }
        }
        Visible::Paths(
            candidates
                .into_iter()
                .filter(|rel| !ignored.contains(*rel))
                .collect(),
        )
    }

    /// Whether any of these changed paths may be one git does not ignore, from what was already
    /// learned: no git runs, so a path never asked about counts.
    pub(crate) fn any_maybe_visible(&mut self, changed: &[PathBuf]) -> bool {
        self.unsettled(changed)
            .is_none_or(|candidates| !candidates.is_empty())
    }

    /// The changed paths, relative to the root, that are not inside a directory known to be
    /// ignored; `None` when one of them is visible for sure (outside the root, the root itself,
    /// a `.gitignore`).
    fn unsettled<'a>(&mut self, changed: &'a [PathBuf]) -> Option<Vec<&'a Path>> {
        let mut candidates = Vec::new();
        for path in changed {
            let rel = path.strip_prefix(&self.root).ok()?;
            if rel.as_os_str().is_empty() {
                return None;
            }
            if rel.file_name().is_some_and(|name| name == ".gitignore") {
                self.forget();
                return None;
            }
            if !self.is_in_ignored_dir(rel) {
                candidates.push(rel);
            }
        }
        Some(candidates)
    }

    fn is_in_ignored_dir(&self, rel: &Path) -> bool {
        rel.ancestors().any(|path| self.ignored_dirs.contains(path))
    }
}

/// A relative path as git writes it, with `/` on every platform. `None` when it is not UTF-8.
pub(super) fn git_path(path: &Path) -> Option<String> {
    let parts: Option<Vec<&str>> = path.components().map(|c| c.as_os_str().to_str()).collect();
    Some(parts?.join("/"))
}

/// The paths among `paths` (relative to `root`) that git ignores, or `None` when git fails.
fn check_ignore(
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
    Some(
        out.stdout
            .split(|&b| b == 0)
            .filter(|path| !path.is_empty())
            .map(|path| PathBuf::from(String::from_utf8_lossy(path).into_owned()))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::modules::repository::{GitOutput, WorktreeEntry};

    /// Ignores `target/` and `*.log` and records every question.
    #[derive(Default)]
    struct FakeGit {
        asked: Mutex<Vec<Vec<String>>>,
        fail: bool,
    }

    impl RepositoryBackend for FakeGit {
        fn git(&self, _cwd: &Path, _args: &[&str], _max: usize) -> anyhow::Result<GitOutput> {
            unreachable!()
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

        fn read_entry(&self, _root: &Path, _path: &Path, _limit: usize) -> Option<WorktreeEntry> {
            unreachable!()
        }

        fn read_file(&self, _path: &Path, _limit: u64) -> Option<Vec<u8>> {
            unreachable!()
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
            .visible(&git, &paths(&["target/debug/a.o", "src/app.log"]))
            .any());
        assert!(!ignored.visible(&git, &paths(&["target/release/b.o"])).any());
        assert!(ignored
            .visible(&git, &paths(&["target/c.o", "src/main.rs"]))
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
        assert_eq!(asked[1], ["src", "src/main.rs"]);
    }

    #[test]
    fn a_gitignore_change_counts_and_forgets_what_was_learned() {
        let git = FakeGit::default();
        let mut ignored = IgnoredPaths::new("/r".into());
        assert!(!ignored.visible(&git, &paths(&["target/a.o"])).any());

        assert!(ignored.visible(&git, &paths(&["sub/.gitignore"])).any());
        assert!(!ignored.visible(&git, &paths(&["target/a.o"])).any());
        assert_eq!(git.asked.lock().unwrap().len(), 2);
    }

    #[test]
    fn without_git_only_directories_already_learned_are_settled() {
        let git = FakeGit::default();
        let mut ignored = IgnoredPaths::new("/r".into());
        assert!(ignored.any_maybe_visible(&paths(&["target/a.o"])));

        assert!(!ignored.visible(&git, &paths(&["target/a.o"])).any());
        assert!(!ignored.any_maybe_visible(&paths(&["target/debug/b.o"])));
        assert!(ignored.any_maybe_visible(&paths(&["target/c.o", "dist/app.js"])));
        assert!(ignored.any_maybe_visible(&paths(&[".gitignore"])));
        assert!(
            ignored.any_maybe_visible(&paths(&["target/a.o"])),
            "forgotten"
        );
        assert_eq!(git.asked.lock().unwrap().len(), 1);
    }

    #[test]
    fn when_git_cannot_answer_the_change_counts() {
        let git = FakeGit {
            fail: true,
            ..FakeGit::default()
        };
        let mut ignored = IgnoredPaths::new("/r".into());
        assert!(ignored.visible(&git, &paths(&["target/a.o"])).any());
        assert!(ignored
            .visible(&git, &[PathBuf::from("/elsewhere/a.ts")])
            .any());
    }
}
