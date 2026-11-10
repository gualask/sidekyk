//! A `RepositoryBackend` for tests that writes only what it uses: every method of `FakeBackend`
//! panics unless the fake provides it, so a test that reaches one it did not expect fails.

use std::io::Read;
use std::path::{Path, PathBuf};

use super::contracts::FileStamp;
use super::ports::{FolderRules, GitOutput, RepositoryBackend, Walked, WorktreeEntry};

pub(crate) trait FakeBackend: Send + Sync {
    fn git(&self, _cwd: &Path, _args: &[&str], _max: usize) -> anyhow::Result<GitOutput> {
        unreachable!()
    }

    fn git_with_input(
        &self,
        _cwd: &Path,
        _args: &[&str],
        _input: &[u8],
        _max: usize,
    ) -> anyhow::Result<GitOutput> {
        unreachable!()
    }

    fn read_file(&self, _path: &Path, _limit: u64) -> Option<Vec<u8>> {
        unreachable!()
    }

    fn read_entry(&self, _root: &Path, _path: &Path, _limit: usize) -> Option<WorktreeEntry> {
        unreachable!()
    }

    fn file_stamp(&self, _root: &Path, _path: &Path) -> Option<FileStamp> {
        unreachable!()
    }

    fn modified_times(&self, _root: &Path, _paths: &[&str]) -> Vec<Option<i64>> {
        unreachable!()
    }

    fn open_file(&self, _root: &Path, _path: &Path) -> Option<Box<dyn Read + Send>> {
        unreachable!()
    }

    fn is_dir(&self, _path: &Path) -> bool {
        unreachable!()
    }

    fn has_entry(&self, _root: &Path, _path: &Path) -> bool {
        unreachable!()
    }

    fn folders(&self, _root: &Path, _path: &Path) -> Option<Vec<PathBuf>> {
        unreachable!()
    }

    fn walk(&self, _root: &Path, _max: usize) -> Walked {
        unreachable!()
    }

    fn folder_rules(&self, _root: &Path) -> Box<dyn FolderRules> {
        unreachable!()
    }

    fn real_path(&self, _path: &Path) -> Option<PathBuf> {
        unreachable!()
    }
}

impl<T: FakeBackend> RepositoryBackend for T {
    fn git(&self, cwd: &Path, args: &[&str], max_stdout: usize) -> anyhow::Result<GitOutput> {
        FakeBackend::git(self, cwd, args, max_stdout)
    }

    fn git_with_input(
        &self,
        cwd: &Path,
        args: &[&str],
        input: &[u8],
        max_stdout: usize,
    ) -> anyhow::Result<GitOutput> {
        FakeBackend::git_with_input(self, cwd, args, input, max_stdout)
    }

    fn read_file(&self, path: &Path, limit: u64) -> Option<Vec<u8>> {
        FakeBackend::read_file(self, path, limit)
    }

    fn read_entry(&self, root: &Path, path: &Path, limit: usize) -> Option<WorktreeEntry> {
        FakeBackend::read_entry(self, root, path, limit)
    }

    fn file_stamp(&self, root: &Path, path: &Path) -> Option<FileStamp> {
        FakeBackend::file_stamp(self, root, path)
    }

    fn modified_times(&self, root: &Path, paths: &[&str]) -> Vec<Option<i64>> {
        FakeBackend::modified_times(self, root, paths)
    }

    fn open_file(&self, root: &Path, path: &Path) -> Option<Box<dyn Read + Send>> {
        FakeBackend::open_file(self, root, path)
    }

    fn is_dir(&self, path: &Path) -> bool {
        FakeBackend::is_dir(self, path)
    }

    fn has_entry(&self, root: &Path, path: &Path) -> bool {
        FakeBackend::has_entry(self, root, path)
    }

    fn folders(&self, root: &Path, path: &Path) -> Option<Vec<PathBuf>> {
        FakeBackend::folders(self, root, path)
    }

    fn walk(&self, root: &Path, max: usize) -> Walked {
        FakeBackend::walk(self, root, max)
    }

    fn folder_rules(&self, root: &Path) -> Box<dyn FolderRules> {
        FakeBackend::folder_rules(self, root)
    }

    fn real_path(&self, path: &Path) -> Option<PathBuf> {
        FakeBackend::real_path(self, path)
    }
}
