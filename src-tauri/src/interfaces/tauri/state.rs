//! Managed Tauri state: the projects, the repositories they read, and the one place that changes
//! them.

use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use super::tray;
use crate::infrastructure::settings_store;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::projects::{Location, Project, ProjectList};
use sidekyk_core::modules::repositories::{LocalRepositories, Repositories};
use sidekyk_core::modules::repository::{RepositoryChangedEvent, REPOSITORY_CHANGED_EVENT};
use sidekyk_core::modules::search::{self, ListMatch, NoteMatch, SearchRequest, SearchResults};
use sidekyk_core::shared::sync::lock;

pub(crate) struct ProjectsState {
    list: Mutex<ProjectList>,
    /// The id of the project last given to `Repositories::watch`. Held while the project on screen
    /// is read and watched, so calls racing each other end on the project on screen after the
    /// last of them.
    watching: Mutex<Option<String>>,
    /// What reads the local projects' repositories.
    repositories: Arc<dyn Repositories>,
}

impl Default for ProjectsState {
    fn default() -> Self {
        Self {
            list: Mutex::default(),
            watching: Mutex::default(),
            repositories: repositories(),
        }
    }
}

/// This machine's repositories, read here. A dev build started with `SIDEKYK_AGENT=local` reads
/// them through the helper instead, a child process beside the app's binary, as it will read a
/// WSL distro's (`docs/plans/remote-projects.md`).
fn repositories() -> Arc<dyn Repositories> {
    #[cfg(debug_assertions)]
    if std::env::var_os("SIDEKYK_AGENT").is_some_and(|agent| agent == "local") {
        use sidekyk_core::infrastructure::agent::{helper_beside_this_binary, AgentRepositories};
        return Arc::new(AgentRepositories::new(helper_beside_this_binary));
    }
    LocalRepositories::new(
        Arc::new(LocalRepositoryBackend::default()),
        Arc::new(LocalRepositoryWatcher),
    )
}

impl ProjectsState {
    pub(crate) fn list(&self) -> ProjectList {
        lock(&self.list).clone()
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

    /// What reads this machine's repositories.
    pub(crate) fn repositories(&self) -> &dyn Repositories {
        &*self.repositories
    }

    /// The id of the project at `location`, if one is.
    pub(crate) fn id_at(&self, location: &Location) -> Option<String> {
        let list = lock(&self.list);
        let project = list.projects.iter().find(|p| p.location == *location)?;
        Some(project.id.clone())
    }

    /// What reads a project's repository, where it is.
    pub(crate) fn repositories_of(&self, project: &Project) -> anyhow::Result<&dyn Repositories> {
        match project.location {
            Location::Local { .. } => Ok(self.repositories()),
            Location::Wsl { .. } => Err(anyhow::anyhow!("WSL projects cannot be read yet")),
        }
    }

    /// The palette's matches: the projects, the panels the frontend names, and the files of the
    /// project asked for, ranked where its files are kept. Its notes are `notes_of`'s, asked only
    /// for a project of the list.
    pub(crate) fn search(
        &self,
        request: &SearchRequest,
        notes_of: impl FnOnce(&str) -> Option<(Vec<ListMatch>, Vec<NoteMatch>)>,
    ) -> SearchResults {
        let list = self.list();
        let files_of = |id: &str| {
            let project = list.find(id).ok()?;
            self.repositories_of(project)
                .ok()?
                .search_files(&project.repository(), &request.query)
        };
        let notes_of = |id: &str| list.find(id).ok().and_then(|_| notes_of(id));
        search::search(request, &list.projects, files_of, notes_of)
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
        let list = self.update_stored(app, change)?;
        let local_roots: Vec<String> = list
            .projects
            .iter()
            .filter_map(|p| p.location.local_root().map(String::from))
            .collect();
        self.repositories.retain(&local_roots);
        watch_active(app);
        Ok(list)
    }

    /// Changes the list and stores it, and nothing else: for what changes neither the projects
    /// nor the one on screen, such as a project's tiles.
    pub(crate) fn update_stored(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut ProjectList) -> anyhow::Result<()>,
    ) -> anyhow::Result<ProjectList> {
        let mut list = lock(&self.list);
        change(&mut list)?;
        // stored while still locked, so concurrent changes reach the disk in their order
        if let Err(error) = settings_store::save_projects(app, &list) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the projects");
        }
        Ok(list.clone())
    }
}

/// Watches the project on screen, if it is not watched yet, and stops watching the previous one.
pub(crate) fn watch_active(app: &tauri::AppHandle) {
    let state = app.state::<ProjectsState>();
    let mut watching = lock(&state.watching);
    let active = state.active();
    let id = active.as_ref().map(|a| a.id.clone());
    if *watching == id {
        return;
    }
    // the count shown is the previous project's: cleared until the new one is read
    tray::clear(app);
    let readable = active.filter(|project| {
        state
            .repositories_of(project)
            .inspect_err(|error| tracing::warn!(error = %format!("{error:#}"), "not watched"))
            .is_ok()
    });
    match readable {
        Some(project) => {
            let emitter = app.clone();
            let project_id = project.id.clone();
            state.repositories.watch(
                Some(&project.repository()),
                Box::new(move |change| {
                    let event = RepositoryChangedEvent::new(&project_id, change.git_dir);
                    let _ = emitter.emit(REPOSITORY_CHANGED_EVENT, event);
                }),
            );
        }
        None => state.repositories.watch(None, Box::new(|_| {})),
    }
    *watching = id;
}

/// Adds the repository that contains `candidate`, on this machine, and puts it on screen.
pub(crate) fn open_folder(app: &tauri::AppHandle, candidate: &Path) -> anyhow::Result<ProjectList> {
    let state = app.state::<ProjectsState>();
    let found = state.repositories.resolve(candidate)?;
    state.update(app, |list| {
        list.add(Project::local(found));
        Ok(())
    })
}
