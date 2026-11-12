//! The folders holding a file a note names (`app::palette::folders_holding`), read by git in
//! repositories on this machine.

use std::sync::Arc;

use sidekyk_core::app::machines::Machines;
use sidekyk_core::app::palette::folders_holding;
use sidekyk_core::app::projects::{Projects, ProjectsStorage};
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::machines::local::LocalMachine;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::projects::{AvatarColor, Location, Project, ProjectList};
use sidekyk_core::modules::reader::LocalRepositories;

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
    let machines = Machines::new(
        Arc::new(LocalMachine::new(reader)),
        LocalMachine::NAME_CASE,
        Vec::new(),
    );
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
        AvatarColor::FIRST,
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
