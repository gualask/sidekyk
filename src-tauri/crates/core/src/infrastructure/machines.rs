//! The machines a project's repository can be on, this one and WSL distros, and what reads each:
//! where a project is read, and what every machine is told (`docs/features/wsl.md`).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::wsl::{installed_distro, wsl_path, WslRepositories};
use crate::modules::projects::{same_distro, FoundFolder, Location, Project, ProjectList};
use crate::modules::repositories::{OnChange, Repositories};

pub struct Machines {
    /// This machine's repositories.
    local: Arc<dyn Repositories>,
    /// The WSL distros', a helper per distro.
    wsl: WslRepositories,
}

/// This machine, or a WSL distro: what one `Repositories` reads.
enum Machine {
    Local,
    Wsl(String),
}

impl Machine {
    fn holds(&self, location: &Location) -> bool {
        match (self, location) {
            (Self::Local, Location::Local { .. }) => true,
            (Self::Wsl(distro), Location::Wsl { distro: d, .. }) => same_distro(distro, d),
            _ => false,
        }
    }
}

impl Machines {
    /// `helper`: the Linux helper the installer ships, for WSL distros.
    pub fn new(local: Arc<dyn Repositories>, helper: PathBuf) -> Self {
        Self {
            local,
            wsl: WslRepositories::new(helper),
        }
    }

    /// What reads the repository at `location`.
    pub fn of(&self, location: &Location) -> Arc<dyn Repositories> {
        match location {
            Location::Local { .. } => self.local.clone(),
            Location::Wsl { distro, .. } => self.wsl.of(distro),
        }
    }

    /// Whether the repository at `location` can be read without starting what holds it, as the
    /// projects' cards are: a WSL distro that does not run is not started.
    pub fn readable_without_starting(&self, location: &Location) -> anyhow::Result<()> {
        match location {
            Location::Local { .. } => Ok(()),
            Location::Wsl { distro, .. } => self.wsl.readable_without_starting(distro),
        }
    }

    /// What reads each machine's repositories, this one's first; a distro only once asked for.
    fn every(&self) -> Vec<(Machine, Arc<dyn Repositories>)> {
        let wsl = self.wsl.each().into_iter();
        std::iter::once((Machine::Local, self.local.clone()))
            .chain(wsl.map(|(distro, r)| (Machine::Wsl(distro), r as Arc<dyn Repositories>)))
            .collect()
    }

    /// The repository that contains `candidate`: a folder of this machine, or of a WSL distro as
    /// Windows names it (`\\wsl.localhost\<distro>\…`), read in that distro.
    pub fn folder_at(&self, candidate: &Path) -> anyhow::Result<FoundFolder> {
        let Some((distro, path)) = wsl_path(candidate) else {
            return Ok(FoundFolder::local(self.local.resolve(candidate)?));
        };
        // as WSL names it: `ubuntu` typed in the dialog is the project of `Ubuntu`
        let distro = installed_distro(&distro)?;
        let found = self.wsl.of(&distro).resolve(Path::new(&path))?;
        Ok(FoundFolder {
            name: found.name,
            location: Location::Wsl {
                distro,
                root: found.root,
            },
        })
    }

    /// Watches `project`, the one on screen, where its folder is; every other machine first
    /// watches nothing, so a helper left idle closes in time. A project without folder is not
    /// watched.
    pub fn watch(&self, project: Option<&Project>, on_change: OnChange) {
        let followed = project.and_then(Project::repository);
        for (machine, repositories) in self.every() {
            if !followed
                .as_ref()
                .is_some_and(|(folder, _)| machine.holds(folder))
            {
                repositories.watch(None, Box::new(|_| {}));
            }
        }
        if let Some((folder, info)) = followed {
            self.of(folder).watch(Some(&info), on_change);
        }
    }

    /// Tells each machine the folders it still reads, of `list`'s.
    pub fn retain(&self, list: &ProjectList) {
        for (machine, repositories) in self.every() {
            let roots: Vec<String> = list
                .folders()
                .filter(|folder| machine.holds(folder))
                .map(|folder| folder.root().to_string())
                .collect();
            repositories.retain(&roots);
        }
    }

    /// Tells every machine whether the window shows; when it shows again, the location of the
    /// project on screen if this machine saw it change meanwhile (a helper tells its own as a
    /// change).
    pub fn set_visible(&self, visible: bool) -> Option<Location> {
        self.wsl.set_visible(visible);
        let root = self.local.set_visible(visible)?;
        Some(Location::Local { root })
    }

    /// Stops the search in contents going on, wherever it runs.
    pub fn stop_content_search(&self) {
        for (_, repositories) in self.every() {
            repositories.stop_content_search();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::modules::folder::FolderKind;
    use crate::modules::preview::MarkdownDocument;
    use crate::modules::repository::{
        ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles,
        CommitRequest, Directory, FileContent, FileDiffRequest, FileStamp, RecentCommits,
        RepositoryInfo, RepositorySnapshot, RepositorySummary, UnifiedDiff,
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
        fn file_content(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<FileContent> {
            unreachable!()
        }
        fn file_stamp(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<FileStamp> {
            unreachable!()
        }
        fn image(&self, _: &RepositoryInfo, _: &str) -> anyhow::Result<Vec<u8>> {
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

    #[test]
    fn a_project_without_folder_is_never_routed_to_a_machine() {
        let local = Arc::new(Told::default());
        let machines = Machines::new(local.clone(), PathBuf::new());
        let home = Project::new("Home".into(), None);
        let shop = Project::new(
            "shop".into(),
            Some(Location::Local {
                root: "/shop".into(),
            }),
        );

        machines.watch(Some(&home), Box::new(|_| {}));
        machines.retain(&ProjectList {
            projects: vec![home.clone(), shop.clone()],
            ..ProjectList::default()
        });
        assert_eq!(*lock(&local.watched), [None]);
        assert_eq!(*lock(&local.retained), [["/shop"]]);

        machines.watch(Some(&shop), Box::new(|_| {}));
        assert_eq!(*lock(&local.watched), [None, Some("/shop".into())]);
    }
}
