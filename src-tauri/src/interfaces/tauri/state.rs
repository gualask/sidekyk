//! What the entry points still share beside the core's `Projects`: what a folder given on the
//! command line opened, the palette's search, and the folders holding a file a note names.

use std::sync::Mutex;

use sidekyk_core::app::machines::Start;
use sidekyk_core::app::projects::Projects;
use sidekyk_core::modules::projects::{Opened, Project, ProjectFolder};
use sidekyk_core::modules::search::{self, ListMatch, NoteMatch, SearchRequest, SearchResults};
use sidekyk_core::shared::sync::lock;

/// What a folder given on the command line did, until the frontend takes it: a project to show
/// its panels (the app starts at all projects otherwise), or a folder to ask about.
#[derive(Default)]
pub(crate) struct Launch {
    opened: Mutex<Option<Opened>>,
}

impl Launch {
    /// Keeps what a folder given on the command line did, for `take_opened`.
    pub(crate) fn set_opened(&self, opened: Opened) {
        *lock(&self.opened) = Some(opened);
    }

    /// What a folder given on the command line did, once: the frontend shows it, then it is
    /// forgotten.
    pub(crate) fn take_opened(&self) -> Option<Opened> {
        lock(&self.opened).take()
    }
}

/// The palette's matches: the projects, the panels the frontend names, and the files of the
/// folder on screen when it is the project asked for's, ranked where its files are kept: none
/// while its WSL distro is stopped, which only its Start button starts. Its notes are
/// `notes_of`'s, asked only for a project of the list; at all projects, those of every book are
/// `every_notes`', given the projects.
pub(crate) fn search(
    projects: &Projects,
    request: &SearchRequest,
    notes_of: impl FnOnce(&Project) -> Option<(Vec<ListMatch>, Vec<NoteMatch>)>,
    every_notes: impl FnOnce(&[Project]) -> (Vec<ListMatch>, Vec<NoteMatch>),
) -> SearchResults {
    let list = projects.list();
    let on_screen = projects.folder_on_screen();
    let files_of = |id: &str| {
        let (_, folder) = on_screen.as_ref().filter(|(p, _)| p.id == id)?;
        let on = projects.reader(&folder.id, Start::Never).ok()?;
        on.reader.search_files(&on.info, &request.query)
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
    projects: &Projects,
    project_id: &str,
    first: Option<&str>,
    path: &str,
) -> anyhow::Result<Vec<String>> {
    let project = projects.project(project_id)?;
    let first = first.and_then(|id| project.folders.iter().find(|f| f.id == id));
    let on_screen_holds = |folder: &ProjectFolder| {
        projects
            .reader(&folder.id, Start::Never)
            .and_then(|on| on.reader.file_stamp(&on.info, path))
            .is_ok()
    };
    if let Some(folder) = first.filter(|f| on_screen_holds(f)) {
        return Ok(vec![folder.id.clone()]);
    }
    let holds = |folder: &ProjectFolder| {
        projects
            .reader(&folder.id, Start::Never)
            .and_then(|on| on.reader.tree_holds_now(&on.info, path))
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

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Arc;

    use sidekyk_core::app::machines::Machines;
    use sidekyk_core::app::projects::ProjectsStorage;
    use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
    use sidekyk_core::infrastructure::machines::local::LocalMachine;
    use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
    use sidekyk_core::modules::projects::{Location, ProjectList};
    use sidekyk_core::modules::reader::LocalRepositories;

    #[test]
    fn the_project_opened_is_taken_once() {
        let state = Launch::default();
        assert_eq!(state.take_opened(), None);
        let opened = Opened::Project {
            id: "0123456789abcdef".into(),
            folder_id: "0123456789abcdef".into(),
        };
        state.set_opened(opened.clone());
        assert_eq!(state.take_opened(), Some(opened));
        assert_eq!(state.take_opened(), None);
    }

    /// A list kept in memory.
    struct Kept(ProjectList);

    impl ProjectsStorage for Kept {
        fn load(&self) -> ProjectList {
            self.0.clone()
        }
        fn save(&self, _: &ProjectList) -> anyhow::Result<()> {
            Ok(())
        }
    }

    /// `list`'s projects, read on this machine.
    fn this_machine(list: ProjectList) -> Projects {
        let reader = LocalRepositories::new(
            Arc::new(LocalRepositoryBackend::default()),
            Arc::new(LocalRepositoryWatcher::default()),
        );
        let machines = Machines::new(Arc::new(LocalMachine::new(reader)), Vec::new());
        Projects::new(machines, Arc::new(Kept(list)), Arc::new(|_, _| {}))
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
        let state = this_machine(ProjectList {
            projects: vec![project],
            ..Default::default()
        });
        let holding =
            |first: Option<&str>, path: &str| folders_holding(&state, &id, first, path).unwrap();

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
        assert!(folders_holding(&state, "unknown", None, "api.ts").is_err());
    }
}
