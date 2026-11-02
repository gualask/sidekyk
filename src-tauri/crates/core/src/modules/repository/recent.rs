//! The files of a project's tree by their last change, newest first: what an agent touched, with
//! or without git. The disk's own times, so edits made while nobody watched count too.

use std::cmp::Reverse;
use std::path::Path;

use super::contracts::{RecentFile, RecentFiles, RepositoryInfo};
use super::open::existing_root;
use super::ports::RepositoryBackend;
use super::tree::FileTree;

/// The list holds at most this many files, as a folder of the tree does; older ones are counted.
const MAX_RECENT_FILES: usize = 10_000;

/// The tree's files by last change, newest first, those changed at the same time by path. A file
/// gone since the tree was read is left out.
pub fn load_recent_files(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    tree: &FileTree,
) -> anyhow::Result<RecentFiles> {
    let root = existing_root(backend, repository)?;
    let paths: Vec<&str> = tree.files().iter().map(String::as_str).collect();
    let times = backend.modified_times(Path::new(root), &paths);
    let mut dated: Vec<(i64, &str)> = times
        .into_iter()
        .zip(&paths)
        .filter_map(|(time, path)| Some((time?, *path)))
        .collect();
    // the tree's paths are sorted, so a stable sort keeps them in order within a time
    dated.sort_by_key(|&(time, _)| Reverse(time));
    let more = dated.len().saturating_sub(MAX_RECENT_FILES);
    Ok(RecentFiles {
        files: dated
            .into_iter()
            .take(MAX_RECENT_FILES)
            .map(|(modified, path)| RecentFile {
                path: path.to_string(),
                modified,
            })
            .collect(),
        more: u32::try_from(more).unwrap_or(u32::MAX),
        truncated: tree.truncated(),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::modules::repository::FakeBackend;

    /// A disk where each file's time is given, `None` for one gone.
    struct Times(HashMap<String, Option<i64>>);

    impl Times {
        fn new<'a>(files: impl IntoIterator<Item = (&'a str, Option<i64>)>) -> Self {
            Self(
                files
                    .into_iter()
                    .map(|(path, time)| (path.to_string(), time))
                    .collect(),
            )
        }

        fn tree(&self) -> FileTree {
            FileTree::from_paths(self.0.keys().map(String::as_str))
        }
    }

    impl FakeBackend for Times {
        fn is_dir(&self, _path: &Path) -> bool {
            true
        }

        fn modified_times(&self, _root: &Path, paths: &[&str]) -> Vec<Option<i64>> {
            paths.iter().map(|path| self.0[*path]).collect()
        }
    }

    fn info() -> RepositoryInfo {
        RepositoryInfo {
            root: "project".into(),
            name: "project".into(),
        }
    }

    #[test]
    fn newest_first_ties_by_path_and_gone_files_left_out() {
        let disk = Times::new([
            ("b.md", Some(20)),
            ("a/old.txt", Some(10)),
            ("a/new.txt", Some(30)),
            ("gone.txt", None),
            ("a.md", Some(20)),
        ]);
        let recent = load_recent_files(&disk, &info(), &disk.tree()).unwrap();
        let order: Vec<(&str, i64)> = recent
            .files
            .iter()
            .map(|file| (file.path.as_str(), file.modified))
            .collect();
        assert_eq!(
            order,
            [
                ("a/new.txt", 30),
                ("a.md", 20),
                ("b.md", 20),
                ("a/old.txt", 10)
            ]
        );
        assert_eq!((recent.more, recent.truncated), (0, false));
    }

    #[test]
    fn past_the_most_the_oldest_are_counted() {
        let names: Vec<String> = (0..MAX_RECENT_FILES + 2).map(|i| format!("f{i}")).collect();
        let disk = Times::new(
            names
                .iter()
                .enumerate()
                .map(|(i, name)| (name.as_str(), Some(i64::try_from(i).unwrap()))),
        );
        let recent = load_recent_files(&disk, &info(), &disk.tree().with_truncated(true)).unwrap();
        assert_eq!(recent.files.len(), MAX_RECENT_FILES);
        assert_eq!(recent.more, 2);
        assert!(recent.truncated);
        // the newest, the last made
        assert_eq!(recent.files[0].path, format!("f{}", MAX_RECENT_FILES + 1));
    }
}
