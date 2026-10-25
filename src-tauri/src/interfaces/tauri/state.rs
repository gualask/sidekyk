//! Managed Tauri state: the projects, the repositories they read, and the one place that changes
//! them.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::infrastructure::settings_store;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::machines::Machines;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::projects::{FoundFolder, Location, Project, ProjectList};
use sidekyk_core::modules::repositories::{LocalRepositories, Repositories};
use sidekyk_core::modules::repository::{RepositoryChangedEvent, REPOSITORY_CHANGED_EVENT};
use sidekyk_core::modules::search::{self, ListMatch, NoteMatch, SearchRequest, SearchResults};
use sidekyk_core::shared::sync::lock;

pub(crate) struct ProjectsState {
    list: Mutex<ProjectList>,
    /// The id and folder of the project last given to `Repositories::watch`: a project whose
    /// folder moved is watched again. Held while the project on screen is read and watched, so
    /// calls racing each other end on the project on screen after the last of them.
    watching: Mutex<Option<(String, Option<Location>)>>,
    /// What reads the projects' repositories, on this machine and in WSL distros.
    machines: Machines,
    /// The project a folder given on the command line put on screen, until the frontend takes it
    /// to show its panels: the app starts at all projects otherwise.
    opened: Mutex<Option<String>>,
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
            watching: Mutex::default(),
            machines: Machines::new(repositories(), helper),
            opened: Mutex::default(),
        }
    }

    pub(crate) fn list(&self) -> ProjectList {
        lock(&self.list).clone()
    }

    /// Keeps the project a folder given on the command line put on screen, for `take_opened`.
    pub(crate) fn set_opened(&self, id: Option<String>) {
        *lock(&self.opened) = id;
    }

    /// The project a folder given on the command line put on screen, once: the frontend shows its
    /// panels, then it is forgotten.
    pub(crate) fn take_opened(&self) -> Option<String> {
        lock(&self.opened).take()
    }

    /// The project on screen.
    pub(crate) fn active(&self) -> Option<Project> {
        lock(&self.list).active().cloned()
    }

    /// A project the user added. Any other id is refused, so the frontend cannot point git at a
    /// folder of its choosing.
    pub(crate) fn project(&self, id: &str) -> anyhow::Result<Project> {
        lock(&self.list).find(id).cloned()
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

    /// Tells every machine whether the window shows; when it shows again, the id of the project on
    /// screen if it changed meanwhile and nothing told it yet.
    pub(crate) fn set_visible(&self, visible: bool) -> Option<String> {
        let missed = self.machines.set_visible(visible)?;
        let list = lock(&self.list);
        let project = list.at(&missed)?;
        Some(project.id.clone())
    }

    /// Stops the search in contents going on, wherever it runs.
    pub(crate) fn stop_content_search(&self) {
        self.machines.stop_content_search();
    }

    /// The palette's matches: the projects, the panels the frontend names, and the files of the
    /// project asked for, ranked where its files are kept: none while its WSL distro is stopped,
    /// which only its Start button starts. Its notes are `notes_of`'s, asked only for a project of
    /// the list; at all projects, those of every book are `every_notes`', given the projects.
    pub(crate) fn search(
        &self,
        request: &SearchRequest,
        notes_of: impl FnOnce(&Project) -> Option<(Vec<ListMatch>, Vec<NoteMatch>)>,
        every_notes: impl FnOnce(&[Project]) -> (Vec<ListMatch>, Vec<NoteMatch>),
    ) -> SearchResults {
        let list = self.list();
        let files_of = |id: &str| {
            let (folder, info) = list.find(id).ok()?.repository()?;
            self.readable_without_starting(folder).ok()?;
            self.repositories_at(folder)
                .search_files(&info, &request.query)
        };
        let notes_of = |id: &str| list.find(id).ok().and_then(notes_of);
        search::search(request, &list.projects, files_of, notes_of, || {
            every_notes(&list.projects)
        })
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
        watch_active(app);
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

/// Watches the project on screen, if it is not watched yet where its folder is, and stops watching
/// the previous one.
pub(crate) fn watch_active(app: &tauri::AppHandle) {
    let state = app.state::<ProjectsState>();
    let mut watching = lock(&state.watching);
    let active = state.active();
    let watched = active.as_ref().map(|a| (a.id.clone(), a.folder().cloned()));
    if *watching == watched {
        return;
    }
    let emitter = app.clone();
    let project_id = active.as_ref().map(|a| a.id.clone());
    state.machines.watch(
        active.as_ref(),
        Box::new(move |change| {
            if let Some(project_id) = &project_id {
                let event = RepositoryChangedEvent::new(project_id, change);
                let _ = emitter.emit(REPOSITORY_CHANGED_EVENT, event);
            }
        }),
    );
    *watching = watched;
}

/// Puts on screen the project following `candidate`'s folder (inside a repository, the
/// repository's), adding one when none does.
pub(crate) fn open_folder(app: &tauri::AppHandle, candidate: &Path) -> anyhow::Result<ProjectList> {
    let state = app.state::<ProjectsState>();
    let found = state.folder_at(candidate)?;
    state.update(app, |list| {
        list.open_folder(found);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_project_opened_is_taken_once() {
        let state = ProjectsState::new(PathBuf::new());
        assert_eq!(state.take_opened(), None);
        state.set_opened(Some("0123456789abcdef".into()));
        assert_eq!(state.take_opened().as_deref(), Some("0123456789abcdef"));
        assert_eq!(state.take_opened(), None);
    }
}
