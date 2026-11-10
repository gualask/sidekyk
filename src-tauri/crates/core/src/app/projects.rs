//! The project list as every client sees it, and the folder on screen: ids outside the list
//! refused, the list stored in order after each change, the machines told what they keep and
//! watch, a folder's reader by its id (`docs/features/projects.md`, `project-folders.md`).

use std::path::Path;
use std::sync::{Arc, Mutex};

use super::machines::{Machines, Start};
use crate::modules::folder::{RepositoryChange, RepositoryInfo};
use crate::modules::projects::{
    FolderChoice, FoundFolder, Location, NameCase, Opened, Project, ProjectFolder, ProjectList,
};
use crate::modules::reader::Repositories;
use crate::shared::sync::lock;

/// Where the project list is kept between runs: read once at startup, written whole after each
/// change.
pub trait ProjectsStorage: Send + Sync {
    fn load(&self) -> ProjectList;
    fn save(&self, list: &ProjectList) -> anyhow::Result<()>;
}

/// Told when the folder on screen changed on disk in a way that shows: its id, and the change.
pub type OnFolderChange = Arc<dyn Fn(&str, RepositoryChange) + Send + Sync>;

/// A folder of a project of the list, with what reads it where it is.
pub struct FolderReader {
    pub reader: Arc<dyn Repositories>,
    pub info: RepositoryInfo,
}

pub struct Projects {
    list: Mutex<ProjectList>,
    /// The id of the folder on screen, as the client showing it last told it (`show_folder`):
    /// the client's to choose, as its zoom level, so never stored.
    on_screen: Mutex<Option<String>>,
    /// The id and place of the folder last given to the machines to watch: a folder that moved is
    /// watched again. Held while the folder on screen is read and watched, so calls racing each
    /// other end on the folder on screen after the last of them.
    watching: Mutex<Option<(String, Location)>>,
    machines: Machines,
    storage: Arc<dyn ProjectsStorage>,
    on_change: OnFolderChange,
}

impl Projects {
    /// The list as `storage` kept it; nothing is watched until a folder is shown.
    pub fn new(
        machines: Machines,
        storage: Arc<dyn ProjectsStorage>,
        on_change: OnFolderChange,
    ) -> Self {
        Self {
            list: Mutex::new(storage.load()),
            on_screen: Mutex::default(),
            watching: Mutex::default(),
            machines,
            storage,
            on_change,
        }
    }

    pub fn list(&self) -> ProjectList {
        lock(&self.list).clone()
    }

    /// A project the user added; any other id is refused.
    pub fn project(&self, id: &str) -> anyhow::Result<Project> {
        lock(&self.list).find(id).cloned()
    }

    /// A folder of a project the user added, and its project. Any other id is refused, so a client
    /// cannot point git at a folder of its choosing.
    pub fn folder(&self, id: &str) -> anyhow::Result<(Project, ProjectFolder)> {
        let list = lock(&self.list);
        let (project, folder) = list.folder(id)?;
        Ok((project.clone(), folder.clone()))
    }

    /// The folder on screen, and its project, while the list has it.
    pub fn folder_on_screen(&self) -> Option<(Project, ProjectFolder)> {
        let id = lock(&self.on_screen).clone()?;
        self.folder(&id).ok()
    }

    /// How this machine's file system compares names, for the places of the list.
    pub fn name_case(&self) -> NameCase {
        self.machines.name_case()
    }

    /// What reads a folder of a project the user added, as `start` allows: `Start::Never` fails
    /// `distro_stopped` for a stopped WSL distro.
    pub fn reader(&self, folder_id: &str, start: Start) -> anyhow::Result<FolderReader> {
        let (project, folder) = self.folder(folder_id)?;
        Ok(FolderReader {
            reader: self.machines.of(&folder.location, start)?,
            info: folder.repository(&project),
        })
    }

    /// Keeps the folder the client shows, `None` for none, and watches it.
    pub fn show_folder(&self, id: Option<String>) {
        *lock(&self.on_screen) = id;
        self.watch_on_screen();
    }

    /// Tells every machine whether the client shows; when it shows again, the id of the folder on
    /// screen if it changed meanwhile and nothing told it yet.
    pub fn set_visible(&self, visible: bool) -> Option<String> {
        let missed = self.machines.set_visible(visible)?;
        let list = lock(&self.list);
        let (_, folder) = list.folder_at(&missed, self.machines.name_case())?;
        Some(folder.id.clone())
    }

    /// The repository that contains `candidate`, or the folder itself without git, on this machine
    /// or another.
    pub fn folder_at(&self, candidate: &Path) -> anyhow::Result<FoundFolder> {
        self.machines.folder_at(candidate)
    }

    /// What the folder at `path`, picked for a new project, is: another project's, or one to
    /// follow, with the repositories right inside it and whose each is.
    pub fn folder_choice(&self, path: &Path) -> anyhow::Result<FolderChoice> {
        let found = self.machines.folder_at(path)?;
        let inside = self.machines.repositories_inside(&found)?;
        // given back to `create_project` as a string, as every path a client holds
        let path = path
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("the folder's path is not Unicode"))?
            .to_string();
        let case = self.machines.name_case();
        Ok(self.list().folder_choice(path, found, inside, case))
    }

    /// Puts on screen the project following `candidate`'s folder (inside a repository, the
    /// repository's), adding one when none does; a folder of no project above repositories of no
    /// project changes nothing, and comes back to ask what it becomes, as the New project dialog
    /// does.
    pub fn open_folder(&self, candidate: &Path) -> anyhow::Result<Opened> {
        let found = self.machines.folder_at(candidate)?;
        let case = self.machines.name_case();
        if self.list().at(&found.location, case).is_none() {
            let inside = self.machines.repositories_inside(&found)?;
            let path = candidate.to_string_lossy().into_owned();
            let choice = self.list().folder_choice(path, found.clone(), inside, case);
            if choice.holds_free_repositories() {
                return Ok(Opened::Choice { choice });
            }
        }
        let (opened, _) = self.update(|list, case| Ok(list.open_folder(found, case)))?;
        Ok(opened)
    }

    /// Changes the list (given how this machine compares names), stores it, tells the machines the
    /// folders they keep and watches the folder now on screen; gives back what `change` returns,
    /// with the list.
    pub fn update<T>(
        &self,
        change: impl FnOnce(&mut ProjectList, NameCase) -> anyhow::Result<T>,
    ) -> anyhow::Result<(T, ProjectList)> {
        let (value, list) = self.change_and_store(change)?;
        self.machines.retain(&list);
        self.watch_on_screen();
        Ok((value, list))
    }

    /// Changes the list and stores it, and nothing else: for what changes neither the folders nor
    /// the one on screen, such as a project's name or tiles.
    pub fn update_stored(
        &self,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<()>,
    ) -> anyhow::Result<ProjectList> {
        self.change_and_store(|list, _| change(list))
            .map(|((), list)| list)
    }

    fn change_and_store<T>(
        &self,
        change: impl FnOnce(&mut ProjectList, NameCase) -> anyhow::Result<T>,
    ) -> anyhow::Result<(T, ProjectList)> {
        let mut list = lock(&self.list);
        let value = change(&mut list, self.machines.name_case())?;
        // stored while still locked, so concurrent changes reach the disk in their order; one that
        // fails stays for the session
        if let Err(error) = self.storage.save(&list) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the projects");
        }
        Ok((value, list.clone()))
    }

    /// Watches the folder on screen, if it is not watched yet where it is, and stops watching the
    /// previous one.
    fn watch_on_screen(&self) {
        let mut watching = lock(&self.watching);
        let active = self.folder_on_screen();
        let watched = active
            .as_ref()
            .map(|(_, folder)| (folder.id.clone(), folder.location.clone()));
        if *watching == watched {
            return;
        }
        let on_change = self.on_change.clone();
        let folder_id = watched.as_ref().map(|(id, _)| id.clone());
        self.machines.watch(
            active
                .as_ref()
                .map(|(project, folder)| (&folder.location, folder.repository(project))),
            Box::new(move |change| {
                if let Some(folder_id) = &folder_id {
                    on_change(folder_id, change);
                }
            }),
        );
        *watching = watched;
    }

    /// How the machine holding `folder` names `path`, a path of this host, as `start` allows.
    pub fn host_path(
        &self,
        folder: &Location,
        path: &Path,
        start: Start,
    ) -> anyhow::Result<String> {
        self.machines.host_path(folder, path, start)
    }

    /// Whether `path`, a path of this host, is inside a project's folder: what Sidekyk never
    /// writes in.
    pub fn holds_host_path(&self, path: &Path) -> bool {
        self.machines.holds_host_path(&lock(&self.list), path)
    }

    /// Stops the search in contents going on, wherever it runs.
    pub fn stop_content_search(&self) {
        self.machines.stop_content_search();
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::app::fake::{Here, Kept, Told};
    use crate::shared::error::{user_facing_code, UserFacingErrorCode};

    pub(crate) fn shop() -> Project {
        Project::new(
            "shop".into(),
            [Location::Local {
                root: "/dev/shop".into(),
            }],
        )
    }

    /// `list`'s projects on this machine, read by `told`.
    pub(crate) fn projects(list: ProjectList, told: &Arc<Told>) -> (Projects, Arc<Kept>) {
        let storage = Arc::new(Kept {
            list,
            ..Kept::default()
        });
        let machines = Machines::new(Arc::new(Here(told.clone())), Vec::new());
        let projects = Projects::new(machines, storage.clone(), Arc::new(|_, _| {}));
        (projects, storage)
    }

    #[test]
    fn an_id_outside_the_list_is_refused() {
        let told = Arc::new(Told::default());
        let (projects, _) = projects(ProjectList::default(), &told);
        let refused = |result: anyhow::Result<()>| {
            user_facing_code(&result.unwrap_err()) == Some(UserFacingErrorCode::ProjectNotFound)
        };
        assert!(refused(projects.project("other").map(|_| ())));
        assert!(refused(projects.folder("other").map(|_| ())));
        assert!(refused(projects.reader("other", Start::May).map(|_| ())));
    }

    #[test]
    fn each_change_is_stored_and_one_not_stored_stays_for_the_session() {
        let told = Arc::new(Told::default());
        let (projects, storage) = projects(ProjectList::default(), &told);
        let shop = shop();
        let added = shop.clone();
        projects
            .update(|list, _| {
                list.projects.push(added);
                Ok(())
            })
            .unwrap();
        assert_eq!(lock(&storage.saved).len(), 1);
        // the machine keeps the folders of the list
        assert_eq!(lock(&told.retained).last().unwrap(), &["/dev/shop"]);

        *lock(&storage.refuse) = true;
        let renamed = projects
            .update_stored(|list| list.rename(&shop.id, "store"))
            .unwrap();
        assert_eq!(renamed.projects[0].name, "store");
        assert_eq!(projects.project(&shop.id).unwrap().name, "store");
        assert_eq!(lock(&storage.saved).len(), 1);
    }

    #[test]
    fn the_folder_on_screen_is_watched_once_and_a_change_missed_comes_back_by_its_id() {
        let shop = shop();
        let folder = shop.folders[0].id.clone();
        let told = Arc::new(Told::default());
        let list = ProjectList {
            projects: vec![shop],
            ..ProjectList::default()
        };
        let (projects, _) = projects(list, &told);

        projects.show_folder(Some(folder.clone()));
        projects.show_folder(Some(folder.clone()));
        assert_eq!(*lock(&told.watched), [Some("/dev/shop".to_string())]);
        projects.show_folder(None);
        assert_eq!(lock(&told.watched).last(), Some(&None));

        // a change seen while hidden comes back as the folder's id once the window shows
        *lock(&told.missed) = Some("/dev/shop".into());
        assert_eq!(projects.set_visible(false), None);
        assert_eq!(projects.set_visible(true), Some(folder));
    }
}
