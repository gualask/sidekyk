//! Managed Tauri state: the projects, the repositories they read, and the one place that changes
//! them.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::infrastructure::settings_store;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::machines::Machines;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::folder::{RepositoryChangedEvent, REPOSITORY_CHANGED_EVENT};
use sidekyk_core::modules::projects::{
    FoundFolder, Location, Opened, Project, ProjectFolder, ProjectList,
};
use sidekyk_core::modules::reader::{LocalRepositories, Repositories};
use sidekyk_core::modules::search::{self, ListMatch, NoteMatch, SearchRequest, SearchResults};
use sidekyk_core::shared::sync::lock;

pub(crate) struct ProjectsState {
    list: Mutex<ProjectList>,
    /// The id of the folder on screen, as the window last told it (`show_folder`): the window's
    /// to choose, as its zoom level, so never stored.
    on_screen: Mutex<Option<String>>,
    /// The id and place of the folder last given to `Repositories::watch`: a folder that moved is
    /// watched again. Held while the folder on screen is read and watched, so calls racing each
    /// other end on the folder on screen after the last of them.
    watching: Mutex<Option<(String, Location)>>,
    /// What reads the projects' repositories, on this machine and in WSL distros.
    machines: Machines,
    /// What a folder given on the command line did, until the frontend takes it: a project to
    /// show its panels (the app starts at all projects otherwise), or a folder to ask about.
    opened: Mutex<Option<Opened>>,
}

/// This machine's repositories, read here. A dev build started with `SIDEKYK_AGENT=local` reads
/// them through the helper instead, a child process beside the app's binary, as it will read a
/// WSL distro's (`docs/features/wsl.md`).
fn repositories() -> Arc<dyn Repositories> {
    #[cfg(debug_assertions)]
    if std::env::var_os("SIDEKYK_AGENT").is_some_and(|agent| agent == "local") {
        use sidekyk_core::infrastructure::agent::{helper_beside_this_binary, AgentRepositories};
        return Arc::new(AgentRepositories::new(|| Ok(helper_beside_this_binary())));
    }
    LocalRepositories::new(
        Arc::new(LocalRepositoryBackend::default()),
        Arc::new(LocalRepositoryWatcher::default()),
    )
}

impl ProjectsState {
    /// `helper`: the Linux helper the installer ships, for WSL distros.
    pub(crate) fn new(helper: PathBuf) -> Self {
        Self {
            list: Mutex::default(),
            on_screen: Mutex::default(),
            watching: Mutex::default(),
            machines: Machines::new(repositories(), helper),
            opened: Mutex::default(),
        }
    }

    pub(crate) fn list(&self) -> ProjectList {
        lock(&self.list).clone()
    }

    /// Keeps what a folder given on the command line did, for `take_opened`.
    pub(crate) fn set_opened(&self, opened: Opened) {
        *lock(&self.opened) = Some(opened);
    }

    /// What a folder given on the command line did, once: the frontend shows it, then it is
    /// forgotten.
    pub(crate) fn take_opened(&self) -> Option<Opened> {
        lock(&self.opened).take()
    }

    /// The folder on screen, and its project, while the list has it.
    pub(crate) fn folder_on_screen(&self) -> Option<(Project, ProjectFolder)> {
        let id = lock(&self.on_screen).clone()?;
        self.folder(&id).ok()
    }

    /// Keeps the folder the window shows, `None` for none, and watches it.
    pub(crate) fn show_folder(&self, app: &tauri::AppHandle, id: Option<String>) {
        *lock(&self.on_screen) = id;
        watch_on_screen(app);
    }

    /// A project the user added.
    pub(crate) fn project(&self, id: &str) -> anyhow::Result<Project> {
        lock(&self.list).find(id).cloned()
    }

    /// A folder of a project the user added, and its project. Any other id is refused, so the
    /// frontend cannot point git at a folder of its choosing.
    pub(crate) fn folder(&self, id: &str) -> anyhow::Result<(Project, ProjectFolder)> {
        let list = lock(&self.list);
        let (project, folder) = list.folder(id)?;
        Ok((project.clone(), folder.clone()))
    }

    /// What reads the repository at `folder`, where it is.
    pub(crate) fn repositories_at(&self, folder: &Location) -> Arc<dyn Repositories> {
        self.machines.of(folder)
    }

    /// Whether the folder at `folder` can be read without starting what holds it: everything but
    /// a project's Start button reads it so.
    pub(crate) fn readable_without_starting(&self, folder: &Location) -> anyhow::Result<()> {
        self.machines.readable_without_starting(folder)
    }

    /// The repository that contains `candidate`, on this machine or in a WSL distro.
    pub(crate) fn folder_at(&self, candidate: &Path) -> anyhow::Result<FoundFolder> {
        self.machines.folder_at(candidate)
    }

    /// Tells every machine whether the window shows; when it shows again, the id of the folder on
    /// screen if it changed meanwhile and nothing told it yet.
    pub(crate) fn set_visible(&self, visible: bool) -> Option<String> {
        let missed = self.machines.set_visible(visible)?;
        let list = lock(&self.list);
        let (_, folder) = list.folder_at(&missed)?;
        Some(folder.id.clone())
    }

    /// The repositories right inside `found`, a folder without git, where it is.
    pub(crate) fn repositories_inside(
        &self,
        found: &FoundFolder,
    ) -> anyhow::Result<Vec<FoundFolder>> {
        self.machines.repositories_inside(found)
    }

    /// Stops the search in contents going on, wherever it runs.
    pub(crate) fn stop_content_search(&self) {
        self.machines.stop_content_search();
    }

    /// The palette's matches: the projects, the panels the frontend names, and the files of the
    /// folder on screen when it is the project asked for's, ranked where its files are kept: none
    /// while its WSL distro is stopped, which only its Start button starts. Its notes are `notes_of`'s, asked only for a project of
    /// the list; at all projects, those of every book are `every_notes`', given the projects.
    pub(crate) fn search(
        &self,
        request: &SearchRequest,
        notes_of: impl FnOnce(&Project) -> Option<(Vec<ListMatch>, Vec<NoteMatch>)>,
        every_notes: impl FnOnce(&[Project]) -> (Vec<ListMatch>, Vec<NoteMatch>),
    ) -> SearchResults {
        let list = self.list();
        let on_screen = self.folder_on_screen();
        let files_of = |id: &str| {
            let (project, folder) = on_screen.as_ref().filter(|(p, _)| p.id == id)?;
            self.readable_without_starting(&folder.location).ok()?;
            self.repositories_at(&folder.location)
                .search_files(&folder.repository(project), &request.query)
        };
        let notes_of = |id: &str| list.find(id).ok().and_then(notes_of);
        search::search(request, &list.projects, files_of, notes_of, || {
            every_notes(&list.projects)
        })
    }

    /// The folders of a project whose tree holds `path`, a file a note names: only `first`, the
    /// folder on screen, when it does (its cached tree, which its watcher keeps fresh); else the
    /// others that do, in the project's order, their trees read again side by side and not kept.
    /// A path outside a tree (moved, deleted, ignored, through `..`) is in none; a folder that
    /// cannot be read, or only by starting its WSL distro, is left out.
    pub(crate) fn folders_holding(
        &self,
        project_id: &str,
        first: Option<&str>,
        path: &str,
    ) -> anyhow::Result<Vec<String>> {
        let project = self.list().find(project_id)?.clone();
        let readable =
            |folder: &ProjectFolder| self.readable_without_starting(&folder.location).is_ok();
        let first = first.and_then(|id| project.folders.iter().find(|f| f.id == id));
        let on_screen_holds = |folder: &ProjectFolder| {
            readable(folder)
                && self
                    .repositories_at(&folder.location)
                    .file_stamp(&folder.repository(&project), path)
                    .is_ok()
        };
        if let Some(folder) = first.filter(|f| on_screen_holds(f)) {
            return Ok(vec![folder.id.clone()]);
        }
        let holds = |folder: &ProjectFolder| {
            readable(folder)
                && self
                    .repositories_at(&folder.location)
                    .tree_holds_now(&folder.repository(&project), path)
                    .unwrap_or(false)
        };
        let others: Vec<&ProjectFolder> = project
            .folders
            .iter()
            .filter(|f| first.is_none_or(|first| first.id != f.id))
            .collect();
        let held: Vec<bool> = std::thread::scope(|scope| {
            let checks: Vec<_> = others
                .iter()
                .map(|folder| scope.spawn(|| holds(folder)))
                .collect();
            checks
                .into_iter()
                .map(|check| check.join().unwrap_or(false))
                .collect()
        });
        Ok(others
            .into_iter()
            .zip(held)
            .filter(|(_, held)| *held)
            .map(|(folder, _)| folder.id.clone())
            .collect())
    }

    /// Replaces the list at startup, before anything is watched.
    pub(crate) fn restore(&self, list: ProjectList) {
        *lock(&self.list) = list;
    }

    /// Changes the list, stores it, and watches the project now on screen.
    pub(crate) fn update(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<()>,
    ) -> anyhow::Result<ProjectList> {
        self.update_with(app, change).map(|((), list)| list)
    }

    /// As `update`, giving back what `change` returns with the list.
    pub(crate) fn update_with<T>(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<T>,
    ) -> anyhow::Result<(T, ProjectList)> {
        let (value, list) = self.change_and_store(app, change)?;
        self.machines.retain(&list);
        watch_on_screen(app);
        Ok((value, list))
    }

    /// Changes the list and stores it, and nothing else: for what changes neither the projects
    /// nor the one on screen, such as a project's tiles.
    pub(crate) fn update_stored(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<()>,
    ) -> anyhow::Result<ProjectList> {
        self.change_and_store(app, change).map(|((), list)| list)
    }

    fn change_and_store<T>(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<T>,
    ) -> anyhow::Result<(T, ProjectList)> {
        let mut list = lock(&self.list);
        let value = change(&mut list)?;
        // stored while still locked, so concurrent changes reach the disk in their order
        if let Err(error) = settings_store::save_projects(app, &list) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the projects");
        }
        Ok((value, list.clone()))
    }
}

/// Watches the folder on screen, if it is not watched yet where it is, and stops watching the
/// previous one.
pub(crate) fn watch_on_screen(app: &tauri::AppHandle) {
    let state = app.state::<ProjectsState>();
    let mut watching = lock(&state.watching);
    let active = state.folder_on_screen();
    let watched = active
        .as_ref()
        .map(|(_, folder)| (folder.id.clone(), folder.location.clone()));
    if *watching == watched {
        return;
    }
    let emitter = app.clone();
    let folder_id = watched.as_ref().map(|(id, _)| id.clone());
    state.machines.watch(
        active
            .as_ref()
            .map(|(project, folder)| (&folder.location, folder.repository(project))),
        Box::new(move |change| {
            if let Some(folder_id) = &folder_id {
                let event = RepositoryChangedEvent::new(folder_id, change);
                let _ = emitter.emit(REPOSITORY_CHANGED_EVENT, event);
            }
        }),
    );
    *watching = watched;
}

/// Puts on screen the project following `candidate`'s folder (inside a repository, the
/// repository's), adding one when none does; a folder of no project above repositories of no
/// project changes nothing, and comes back to ask what it becomes, as the New project dialog does.
pub(crate) fn open_folder(app: &tauri::AppHandle, candidate: &Path) -> anyhow::Result<Opened> {
    let state = app.state::<ProjectsState>();
    let found = state.folder_at(candidate)?;
    let list = state.list();
    if list.at(&found.location).is_none() {
        let inside = state.repositories_inside(&found)?;
        let path = candidate.to_string_lossy().into_owned();
        let choice = list.folder_choice(path, found.clone(), inside);
        if choice.holds_free_repositories() {
            return Ok(Opened::Choice { choice });
        }
    }
    let (opened, _) = state.update_with(app, |list| Ok(list.open_folder(found)))?;
    Ok(opened)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_project_opened_is_taken_once() {
        let state = ProjectsState::new(PathBuf::new());
        assert_eq!(state.take_opened(), None);
        let opened = Opened::Project {
            id: "0123456789abcdef".into(),
            folder_id: "0123456789abcdef".into(),
        };
        state.set_opened(opened.clone());
        assert_eq!(state.take_opened(), Some(opened));
        assert_eq!(state.take_opened(), None);
    }

    /// A repository at a new temporary folder holding `files`, its root as git names it.
    fn repository(files: &[&str]) -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let status = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&root)
            .status()
            .unwrap();
        assert!(status.success());
        for file in files {
            std::fs::write(root.join(file), "x").unwrap();
        }
        (dir, root.to_string_lossy().replace('\\', "/"))
    }

    #[test]
    fn a_file_a_note_names_is_looked_for_on_screen_first_then_in_the_other_folders() {
        let (_api, api_root) = repository(&["shared.ts", "api.ts"]);
        let (web_dir, web_root) = repository(&["shared.ts", "web.ts"]);
        let project = Project::new(
            "shop".into(),
            [
                Location::Local { root: api_root },
                Location::Local { root: web_root },
            ],
        );
        let (id, api, web) = (
            project.id.clone(),
            project.folders[0].id.clone(),
            project.folders[1].id.clone(),
        );
        let state = ProjectsState::new(PathBuf::new());
        state.restore(ProjectList {
            projects: vec![project],
            ..Default::default()
        });
        let holding =
            |first: Option<&str>, path: &str| state.folders_holding(&id, first, path).unwrap();

        // the folder on screen alone when it has the file, though the other has it too
        assert_eq!(holding(Some(&api), "shared.ts"), std::slice::from_ref(&api));
        // else the other folders that have it, in the project's order
        assert_eq!(holding(Some(&api), "web.ts"), std::slice::from_ref(&web));
        assert_eq!(holding(None, "shared.ts"), [api.clone(), web.clone()]);
        // moved, deleted or outside the tree: in none
        assert!(holding(Some(&api), "gone.ts").is_empty());
        // another folder's tree is read as it is now: a file an agent just wrote there, or removed
        let fresh = web_dir.path().join("fresh.ts");
        std::fs::write(&fresh, "x").unwrap();
        assert_eq!(holding(Some(&api), "fresh.ts"), std::slice::from_ref(&web));
        std::fs::remove_file(&fresh).unwrap();
        assert!(holding(Some(&api), "fresh.ts").is_empty());
        assert!(holding(Some(&api), "../api.ts").is_empty());
        assert!(state.folders_holding("unknown", None, "api.ts").is_err());
    }
}
