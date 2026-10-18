//! The machines a project's repository can be on, this one and WSL distros, and what reads each:
//! where a project is read, and what every machine is told (`docs/plans/remote-projects.md`).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::wsl::{installed_distro, wsl_path, WslRepositories};
use crate::modules::projects::{Location, Project};
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
            (Self::Wsl(distro), Location::Wsl { distro: d, .. }) => distro.eq_ignore_ascii_case(d),
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

    /// The project that contains `candidate`: a folder of this machine, or of a WSL distro as
    /// Windows names it (`\\wsl.localhost\<distro>\…`), read in that distro.
    pub fn project_at(&self, candidate: &Path) -> anyhow::Result<Project> {
        let Some((distro, path)) = wsl_path(candidate) else {
            return Ok(Project::local(self.local.resolve(candidate)?));
        };
        // as WSL names it: `ubuntu` typed in the dialog is the project of `Ubuntu`
        let distro = installed_distro(&distro)?;
        let found = self.wsl.of(&distro).resolve(Path::new(&path))?;
        Ok(Project::new(
            found.name,
            Location::Wsl {
                distro,
                root: found.root,
            },
        ))
    }

    /// Watches `project`, the one on screen, where it is; every other machine first watches
    /// nothing, so a helper left idle closes in time.
    pub fn watch(&self, project: Option<&Project>, on_change: OnChange) {
        for (machine, repositories) in self.every() {
            if !project.is_some_and(|p| machine.holds(&p.location)) {
                repositories.watch(None, Box::new(|_| {}));
            }
        }
        if let Some(project) = project {
            self.of(&project.location)
                .watch(Some(&project.repository()), on_change);
        }
    }

    /// Tells each machine the projects it still reads, of `projects`.
    pub fn retain(&self, projects: &[Project]) {
        for (machine, repositories) in self.every() {
            let roots: Vec<String> = projects
                .iter()
                .filter(|p| machine.holds(&p.location))
                .map(|p| p.location.root().to_string())
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
