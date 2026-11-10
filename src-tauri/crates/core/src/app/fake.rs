//! Fakes for the tests of the application service: a machine that reads nothing, recording what
//! it is told to watch and keep and what it is told of the window; notes kept in memory.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use super::machines::{Machine, MachineReader};
use crate::app::projects::ProjectsStorage;
use crate::modules::folder::{
    Directory, FileContent, FileStamp, FolderKind, RecentFiles, RepositoryInfo,
};
use crate::modules::notes::NotesStorage;
use crate::modules::preview::MarkdownDocument;
use crate::modules::projects::{FoundFolder, Location, NameCase, ProjectList};
use crate::modules::reader::{OnChange, Repositories};
use crate::modules::repository::{
    ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest,
    FileDiffRequest, RecentCommits, RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
use crate::modules::search::{ContentEnd, ContentFile, FileMatches};
use crate::modules::syntax::{SyntaxColors, SyntaxRequest};
use crate::shared::sync::lock;

/// A machine that records what it is told to watch and keep; asked to read, it fails the test.
#[derive(Default)]
pub(crate) struct Told {
    pub(crate) watched: Mutex<Vec<Option<String>>>,
    pub(crate) retained: Mutex<Vec<Vec<String>>>,
    /// The root whose change it saw while the window was hidden, told once it shows again.
    pub(crate) missed: Mutex<Option<String>>,
}

impl Repositories for Told {
    fn resolve(&self, _: &Path) -> anyhow::Result<RepositoryInfo> {
        unreachable!()
    }
    fn repositories_inside(&self, _: &RepositoryInfo) -> anyhow::Result<Vec<RepositoryInfo>> {
        unreachable!()
    }
    fn folder_kind(&self, _: &RepositoryInfo) -> anyhow::Result<FolderKind> {
        unreachable!()
    }
    fn snapshot(&self, _: &RepositoryInfo) -> anyhow::Result<RepositorySnapshot> {
        unreachable!()
    }
    fn summary(&self, _: &RepositoryInfo) -> anyhow::Result<RepositorySummary> {
        unreachable!()
    }
    fn file_diff(&self, _: &RepositoryInfo, _: &FileDiffRequest) -> anyhow::Result<UnifiedDiff> {
        unreachable!()
    }
    fn changes_ignoring_whitespace(
        &self,
        _: &RepositoryInfo,
    ) -> anyhow::Result<ChangesIgnoringWhitespace> {
        unreachable!()
    }
    fn recent_commits(&self, _: &RepositoryInfo) -> anyhow::Result<RecentCommits> {
        unreachable!()
    }
    fn commit_activity(&self, _: &RepositoryInfo, _: i64) -> anyhow::Result<CommitActivity> {
        unreachable!()
    }
    fn commit_files(&self, _: &RepositoryInfo, _: &CommitRequest) -> anyhow::Result<CommitFiles> {
        unreachable!()
    }
    fn commit_file_diff(
        &self,
        _: &RepositoryInfo,
        _: &CommitFileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        unreachable!()
    }
    fn directory(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<Directory> {
        unreachable!()
    }
    fn recent_files(&self, _: &RepositoryInfo) -> anyhow::Result<RecentFiles> {
        unreachable!()
    }
    fn file_content(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<FileContent> {
        unreachable!()
    }
    fn file_stamp(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<FileStamp> {
        unreachable!()
    }
    fn tree_holds_now(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<bool> {
        unreachable!()
    }
    fn image(&self, _: &RepositoryInfo, _: &str, _: Option<&str>) -> anyhow::Result<Vec<u8>> {
        unreachable!()
    }
    fn blob_size(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<u64> {
        unreachable!()
    }
    fn markdown_preview(
        &self,
        _: &RepositoryInfo,
        _: &str,
    ) -> anyhow::Result<Option<MarkdownDocument>> {
        unreachable!()
    }
    fn syntax_colors(&self, _: &RepositoryInfo, _: &SyntaxRequest) -> anyhow::Result<SyntaxColors> {
        unreachable!()
    }
    fn search_files(&self, _: &RepositoryInfo, _: &str) -> Option<FileMatches> {
        unreachable!()
    }
    fn search_contents(
        &self,
        _: &RepositoryInfo,
        _: &str,
        _: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd> {
        unreachable!()
    }
    fn stop_content_search(&self) {}
    fn retain(&self, roots: &[String]) {
        lock(&self.retained).push(roots.to_vec());
    }
    fn watch(&self, repository: Option<&RepositoryInfo>, _: OnChange) {
        lock(&self.watched).push(repository.map(|r| r.root.clone()));
    }
    fn set_visible(&self, visible: bool) -> Option<String> {
        if visible {
            lock(&self.missed).take()
        } else {
            None
        }
    }
}

/// This machine, read by `Told`.
pub(crate) struct Here(pub(crate) Arc<Told>);

impl Machine for Here {
    fn holds(&self, location: &Location) -> bool {
        matches!(location, Location::Local { .. })
    }
    fn reader(&self, _: &Location) -> Arc<dyn Repositories> {
        self.0.clone()
    }
    fn readable_without_starting(&self, _: &Location) -> anyhow::Result<()> {
        Ok(())
    }
    fn readers(&self) -> Vec<MachineReader> {
        vec![MachineReader {
            reader: self.0.clone(),
            holds: Box::new(|location| matches!(location, Location::Local { .. })),
        }]
    }
    fn folder_at(&self, _: &Path) -> Option<anyhow::Result<FoundFolder>> {
        unreachable!()
    }
    fn host_path(&self, _: &Location, _: &Path) -> anyhow::Result<String> {
        unreachable!()
    }
    fn holds_host_path(&self, list: &ProjectList, path: &Path) -> Option<bool> {
        Some(list.holds(path, Path::to_path_buf, NameCase::Kept))
    }
    fn set_visible(&self, visible: bool) -> Option<Location> {
        let root = self.0.set_visible(visible)?;
        Some(Location::Local { root })
    }
}

/// Notes' files in memory, by folder and name; `refuse_removal` makes removing a folder fail.
#[derive(Default)]
pub(crate) struct Shelf {
    files: Mutex<BTreeMap<(String, String), Vec<u8>>>,
    pub(crate) refuse_removal: Mutex<bool>,
}

impl NotesStorage for Shelf {
    fn folders(&self) -> anyhow::Result<Vec<String>> {
        let mut folders: Vec<String> = lock(&self.files).keys().map(|(f, _)| f.clone()).collect();
        folders.dedup();
        Ok(folders)
    }
    fn files(&self, folder: &str) -> anyhow::Result<Vec<String>> {
        Ok(lock(&self.files)
            .keys()
            .filter(|(f, _)| f == folder)
            .map(|(_, name)| name.clone())
            .collect())
    }
    fn read(&self, folder: &str, file: &str, _: u64) -> anyhow::Result<Option<Vec<u8>>> {
        Ok(lock(&self.files)
            .get(&(folder.into(), file.into()))
            .cloned())
    }
    fn write(&self, folder: &str, file: &str, bytes: &[u8]) -> anyhow::Result<()> {
        lock(&self.files).insert((folder.into(), file.into()), bytes.to_vec());
        Ok(())
    }
    fn remove(&self, folder: &str, file: &str) -> anyhow::Result<()> {
        lock(&self.files).remove(&(folder.into(), file.into()));
        Ok(())
    }
    fn remove_folder(&self, folder: &str) -> anyhow::Result<()> {
        anyhow::ensure!(!*lock(&self.refuse_removal), "the folder is in use");
        lock(&self.files).retain(|(f, _), _| f != folder);
        Ok(())
    }
    fn location(&self, folder: &str, file: &str) -> anyhow::Result<String> {
        Ok(format!("/data/notes/{folder}/{file}"))
    }
}

/// A project list kept in memory; each save recorded, or refused while `refuse` is set.
#[derive(Default)]
pub(crate) struct Kept {
    pub(crate) list: ProjectList,
    pub(crate) saved: Mutex<Vec<ProjectList>>,
    pub(crate) refuse: Mutex<bool>,
}

impl ProjectsStorage for Kept {
    fn load(&self) -> ProjectList {
        self.list.clone()
    }
    fn save(&self, list: &ProjectList) -> anyhow::Result<()> {
        anyhow::ensure!(!*lock(&self.refuse), "the disk is full");
        lock(&self.saved).push(list.clone());
        Ok(())
    }
}
