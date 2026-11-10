//! The machines a project's folders can be on, this one and others (WSL distros), and what each
//! is told: where a folder is read, which folders each keeps, what each watches, whether the
//! window shows, and whether a call may start the machine (`Start`) (`docs/features/wsl.md`). Each
//! kind of machine is an adapter of `Machine` (`infrastructure/machines/`); only the composition
//! root names them.

use std::path::Path;
use std::sync::Arc;

use crate::modules::folder::RepositoryInfo;
use crate::modules::projects::{FoundFolder, Location, NameCase, ProjectList};
use crate::modules::reader::{OnChange, Repositories};

/// Whether a call may start the machine holding a folder: "a distro starts only when asked: one
/// rule for every way in" (`docs/features/wsl.md`). A project's Start button, the reads of the
/// project on screen and a note's copy may; the rows, the searches, the images and the folders
/// holding a file never do, and fail `distro_stopped` instead.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Start {
    May,
    Never,
}

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

    /// How the machine holding `location` names `path`, a path of this host: as it is here; in a
    /// WSL distro, as `wslpath` does (`/mnt/c/…`). May start the machine.
    fn host_path(&self, location: &Location, path: &Path) -> anyhow::Result<String>;

    /// Whether `path`, a path of this host as the user picked it, is inside a folder of `list`,
    /// links resolved; `None` when the path is not this machine's.
    fn holds_host_path(&self, list: &ProjectList, path: &Path) -> Option<bool>;

    /// Tells the readers whether the window shows, and those made later. When it shows again, the
    /// folder on screen if this machine saw it change meanwhile and told no one (a helper tells
    /// its own as a change).
    fn set_visible(&self, visible: bool) -> Option<Location>;
}

/// One reader of a machine, and which folders it reads.
pub struct MachineReader {
    pub reader: Arc<dyn Repositories>,
    pub holds: Box<dyn Fn(&Location) -> bool + Send + Sync>,
}

pub struct Machines {
    /// This machine: a host path no other machine claims is its.
    local: Arc<dyn Machine>,
    /// How this machine's file system compares names; a WSL distro's are Linux's, always by case
    /// (`modules/projects/place.rs`).
    name_case: NameCase,
    /// The other kinds: WSL distros.
    others: Vec<Arc<dyn Machine>>,
}

impl Machines {
    pub fn new(
        local: Arc<dyn Machine>,
        name_case: NameCase,
        others: Vec<Arc<dyn Machine>>,
    ) -> Self {
        Self {
            local,
            name_case,
            others,
        }
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

    /// The kind of machine the folder at `location` is on, once `start` allows it: with
    /// `Start::Never`, a machine that does not run fails (`distro_stopped`, `distro_missing`).
    fn allowed(&self, location: &Location, start: Start) -> anyhow::Result<&dyn Machine> {
        let machine = self.holding(location)?;
        if start == Start::Never {
            machine.readable_without_starting(location)?;
        }
        Ok(machine)
    }

    /// What reads the folder at `location`, as `start` allows.
    pub fn of(&self, location: &Location, start: Start) -> anyhow::Result<Arc<dyn Repositories>> {
        Ok(self.allowed(location, start)?.reader(location))
    }

    /// How the machine holding `location` names `path`, a path of this host, as `start` allows.
    pub fn host_path(
        &self,
        location: &Location,
        path: &Path,
        start: Start,
    ) -> anyhow::Result<String> {
        self.allowed(location, start)?.host_path(location, path)
    }

    /// Whether `path`, a path of this host, is inside a folder of `list`, on the machine whose path
    /// it is: what Sidekyk never writes in.
    pub fn holds_host_path(&self, list: &ProjectList, path: &Path) -> bool {
        self.others
            .iter()
            .find_map(|machine| machine.holds_host_path(list, path))
            .or_else(|| self.local.holds_host_path(list, path))
            .unwrap_or(false)
    }

    /// How this machine's file system compares names, for the places of the project list.
    pub fn name_case(&self) -> NameCase {
        self.name_case
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
    /// repository. A folder picked or given is read where it is: its machine may start.
    pub fn repositories_inside(&self, found: &FoundFolder) -> anyhow::Result<Vec<FoundFolder>> {
        let folder = RepositoryInfo {
            root: found.location.root().to_string(),
            name: found.name.clone(),
        };
        let inside = self
            .of(&found.location, Start::May)?
            .repositories_inside(&folder)?;
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
        // the folder on screen: its project's panels read it, as they may start its machine
        if let Some((folder, info)) = followed {
            match self.of(folder, Start::May) {
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
    use crate::app::fake::{Here, Told};
    use crate::modules::projects::Project;
    use crate::shared::error::{user_facing, user_facing_code, UserFacingErrorCode};
    use crate::shared::sync::lock;

    /// A WSL distro that does not run: read, it is started; it records each start.
    #[derive(Default)]
    struct Stopped {
        reader: Arc<Told>,
        started: Mutex<u32>,
    }

    impl Machine for Stopped {
        fn holds(&self, location: &Location) -> bool {
            matches!(location, Location::Wsl { .. })
        }
        fn reader(&self, _: &Location) -> Arc<dyn Repositories> {
            *lock(&self.started) += 1;
            self.reader.clone()
        }
        fn readable_without_starting(&self, _: &Location) -> anyhow::Result<()> {
            Err(user_facing(UserFacingErrorCode::DistroStopped))
        }
        fn readers(&self) -> Vec<MachineReader> {
            Vec::new()
        }
        fn folder_at(&self, _: &Path) -> Option<anyhow::Result<FoundFolder>> {
            None
        }
        fn host_path(&self, _: &Location, path: &Path) -> anyhow::Result<String> {
            *lock(&self.started) += 1;
            Ok(path.to_string_lossy().into_owned())
        }
        fn holds_host_path(&self, _: &ProjectList, _: &Path) -> Option<bool> {
            None
        }
        fn set_visible(&self, _: bool) -> Option<Location> {
            None
        }
    }

    #[test]
    fn a_machine_that_does_not_run_starts_only_when_the_call_may_start_it() {
        let stopped = Arc::new(Stopped::default());
        let machines = Machines::new(
            Arc::new(Here(Arc::new(Told::default()))),
            NameCase::Kept,
            vec![stopped.clone()],
        );
        let api = Location::Wsl {
            distro: "Debian".into(),
            root: "/home/dev/api".into(),
        };
        let refused = |result: anyhow::Result<()>| {
            user_facing_code(&result.unwrap_err()) == Some(UserFacingErrorCode::DistroStopped)
        };
        assert!(refused(machines.of(&api, Start::Never).map(|_| ())));
        let note = Path::new("/notes/a.png");
        assert!(refused(
            machines.host_path(&api, note, Start::Never).map(|_| ())
        ));
        assert_eq!(*lock(&stopped.started), 0);

        assert!(machines.of(&api, Start::May).is_ok());
        assert!(machines.host_path(&api, note, Start::May).is_ok());
        assert_eq!(*lock(&stopped.started), 2);
    }

    #[test]
    fn a_project_without_folder_is_never_routed_to_a_machine() {
        let local = Arc::new(Told::default());
        let machines = Machines::new(Arc::new(Here(local.clone())), NameCase::Kept, Vec::new());
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
