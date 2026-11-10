//! The machines a project's folders can be on, this one and others (WSL distros), and what each
//! is told: where a folder is read, which folders each keeps, what each watches, whether the
//! window shows (`docs/features/wsl.md`). Each kind of machine is an adapter of `Machine`
//! (`infrastructure/machines/`); only the composition root names them.

use std::path::Path;
use std::sync::Arc;

use crate::modules::folder::RepositoryInfo;
use crate::modules::projects::{FoundFolder, Location, NameCase, ProjectList};
use crate::modules::reader::{OnChange, Repositories};

/// A kind of machine a project's folder can be on: this one, or WSL distros. Asked only about
/// the folders it `holds`.
pub trait Machine: Send + Sync {
    /// Whether the folder at `location` is on this kind of machine.
    fn holds(&self, location: &Location) -> bool;

    /// What reads the folder at `location`. Starts nothing until asked something.
    fn reader(&self, location: &Location) -> Arc<dyn Repositories>;

    /// Whether the folder at `location` reads without starting what holds it, as the projects'
    /// rows are: a stopped WSL distro is `distro_stopped`, one gone `distro_missing`.
    fn readable_without_starting(&self, location: &Location) -> anyhow::Result<()>;

    /// The readers made so far, each with the folders it reads: a machine not asked for yet has
    /// none, and is told nothing.
    fn readers(&self) -> Vec<MachineReader>;

    /// The folder at `path` as the host names it (`\\wsl.localhost\<distro>\…` for a distro's),
    /// the repository holding it if any; `None` when the path is not this machine's.
    fn folder_at(&self, path: &Path) -> Option<anyhow::Result<FoundFolder>>;

    /// Tells the readers whether the window shows, and those made later. When it shows again, the
    /// folder on screen if this machine saw it change meanwhile and told no one (a helper tells
    /// its own as a change).
    fn set_visible(&self, visible: bool) -> Option<Location>;

    /// How its file system compares names.
    fn name_case(&self) -> NameCase;
}

/// One reader of a machine, and which folders it reads.
pub struct MachineReader {
    pub reader: Arc<dyn Repositories>,
    pub holds: Box<dyn Fn(&Location) -> bool + Send + Sync>,
}

pub struct Machines {
    /// This machine: a host path no other machine claims is its.
    local: Arc<dyn Machine>,
    /// The other kinds: WSL distros.
    others: Vec<Arc<dyn Machine>>,
}

impl Machines {
    pub fn new(local: Arc<dyn Machine>, others: Vec<Arc<dyn Machine>>) -> Self {
        Self { local, others }
    }

    /// Every kind of machine, this one first.
    fn kinds(&self) -> impl Iterator<Item = &Arc<dyn Machine>> {
        std::iter::once(&self.local).chain(&self.others)
    }

    /// The kind of machine the folder at `location` is on.
    fn holding(&self, location: &Location) -> anyhow::Result<&dyn Machine> {
        self.kinds()
            .find(|machine| machine.holds(location))
            .map(|machine| &**machine)
            .ok_or_else(|| anyhow::anyhow!("no machine holds {location:?}"))
    }

    /// What reads the folder at `location`.
    pub fn of(&self, location: &Location) -> anyhow::Result<Arc<dyn Repositories>> {
        Ok(self.holding(location)?.reader(location))
    }

    /// Whether the folder at `location` can be read without starting what holds it, as the
    /// projects' rows are: a WSL distro that does not run is not started.
    pub fn readable_without_starting(&self, location: &Location) -> anyhow::Result<()> {
        self.holding(location)?.readable_without_starting(location)
    }

    /// How this machine's file system compares names, for the places of the project list.
    pub fn name_case(&self) -> NameCase {
        self.local.name_case()
    }

    /// Every reader made so far, this machine's first.
    fn readers(&self) -> Vec<MachineReader> {
        self.kinds().flat_map(|machine| machine.readers()).collect()
    }

    /// The repository that contains `candidate`, or the folder itself without git: on the machine
    /// whose path it is, this one when no other claims it.
    pub fn folder_at(&self, candidate: &Path) -> anyhow::Result<FoundFolder> {
        self.others
            .iter()
            .find_map(|machine| machine.folder_at(candidate))
            .or_else(|| self.local.folder_at(candidate))
            .unwrap_or_else(|| anyhow::bail!("no machine holds {}", candidate.display()))
    }

    /// The repositories right inside `found`, a folder without git, on its machine: none for a
    /// repository.
    pub fn repositories_inside(&self, found: &FoundFolder) -> anyhow::Result<Vec<FoundFolder>> {
        let folder = RepositoryInfo {
            root: found.location.root().to_string(),
            name: found.name.clone(),
        };
        let inside = self.of(&found.location)?.repositories_inside(&folder)?;
        Ok(inside
            .into_iter()
            .map(|repository| FoundFolder {
                name: repository.name,
                location: found.location.with_root(repository.root),
            })
            .collect())
    }

    /// Watches `followed`, the folder on screen, as its repository, where it is; every other reader
    /// first watches nothing, so a helper left idle closes in time. A project without folder
    /// watches none.
    pub fn watch(&self, followed: Option<(&Location, RepositoryInfo)>, on_change: OnChange) {
        for machine in self.readers() {
            if !followed
                .as_ref()
                .is_some_and(|(folder, _)| (machine.holds)(folder))
            {
                machine.reader.watch(None, Box::new(|_| {}));
            }
        }
        if let Some((folder, info)) = followed {
            match self.of(folder) {
                Ok(reader) => reader.watch(Some(&info), on_change),
                Err(error) => tracing::warn!(error = %format!("{error:#}"), "nothing to watch"),
            }
        }
    }

    /// Tells each reader the folders it still reads, of `list`'s.
    pub fn retain(&self, list: &ProjectList) {
        for machine in self.readers() {
            let roots: Vec<String> = list
                .folders()
                .filter(|folder| (machine.holds)(folder))
                .map(|folder| folder.root().to_string())
                .collect();
            machine.reader.retain(&roots);
        }
    }

    /// Tells every machine whether the window shows; when it shows again, the location of the
    /// folder on screen if a machine saw it change meanwhile.
    pub fn set_visible(&self, visible: bool) -> Option<Location> {
        self.kinds()
            .map(|machine| machine.set_visible(visible))
            .fold(None, |missed, told| missed.or(told))
    }

    /// Stops the search in contents going on, wherever it runs.
    pub fn stop_content_search(&self) {
        for machine in self.readers() {
            machine.reader.stop_content_search();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::modules::folder::FolderKind;
    use crate::modules::folder::{Directory, FileContent, FileStamp, RecentFiles};
    use crate::modules::preview::MarkdownDocument;
    use crate::modules::projects::Project;
    use crate::modules::repository::{
        ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles,
        CommitRequest, FileDiffRequest, RecentCommits, RepositorySnapshot, RepositorySummary,
        UnifiedDiff,
    };
    use crate::modules::search::{ContentEnd, ContentFile, FileMatches};
    use crate::modules::syntax::{SyntaxColors, SyntaxRequest};
    use crate::shared::sync::lock;

    /// A machine that records what it is told to watch and keep; asked to read, it fails the test.
    #[derive(Default)]
    struct Told {
        watched: Mutex<Vec<Option<String>>>,
        retained: Mutex<Vec<Vec<String>>>,
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
        fn file_diff(
            &self,
            _: &RepositoryInfo,
            _: &FileDiffRequest,
        ) -> anyhow::Result<UnifiedDiff> {
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
        fn commit_files(
            &self,
            _: &RepositoryInfo,
            _: &CommitRequest,
        ) -> anyhow::Result<CommitFiles> {
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
        fn syntax_colors(
            &self,
            _: &RepositoryInfo,
            _: &SyntaxRequest,
        ) -> anyhow::Result<SyntaxColors> {
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
        fn set_visible(&self, _: bool) -> Option<String> {
            None
        }
    }

    /// This machine, read by `Told`.
    struct Here(Arc<Told>);

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
        fn set_visible(&self, _: bool) -> Option<Location> {
            None
        }
        fn name_case(&self) -> NameCase {
            NameCase::Kept
        }
    }

    #[test]
    fn a_project_without_folder_is_never_routed_to_a_machine() {
        let local = Arc::new(Told::default());
        let machines = Machines::new(Arc::new(Here(local.clone())), Vec::new());
        let home = Project::new("Home".into(), []);
        let shop = Project::new(
            "shop".into(),
            [Location::Local {
                root: "/shop".into(),
            }],
        );

        machines.watch(None, Box::new(|_| {}));
        machines.retain(&ProjectList {
            projects: vec![home.clone(), shop.clone()],
            ..ProjectList::default()
        });
        assert_eq!(*lock(&local.watched), [None]);
        assert_eq!(*lock(&local.retained), [["/shop"]]);

        let folder = &shop.folders[0];
        machines.watch(
            Some((&folder.location, folder.repository(&shop))),
            Box::new(|_| {}),
        );
        assert_eq!(*lock(&local.watched), [None, Some("/shop".into())]);
    }
}
