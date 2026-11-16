//! What a note names across the project list: the folders of a project that hold a file a note
//! names (`docs/features/note-references.md`).

use super::machines::Start;
use super::projects::Projects;
use crate::modules::projects::ProjectFolder;

/// The folders of a project whose tree holds `path`, a file a note names: only `first`, the
/// folder on screen, when it does (its cached tree, which its watcher keeps fresh); else the
/// others that do, in the project's order, their trees read again side by side and not kept.
/// A path outside a tree (moved, deleted, ignored, through `..`) is in none; a folder that
/// cannot be read, or only by starting its WSL distro, is left out.
pub fn folders_holding(
    projects: &Projects,
    project_id: &str,
    first: Option<&str>,
    path: &str,
) -> anyhow::Result<Vec<String>> {
    let project = projects.project(project_id)?;
    let first = first.and_then(|id| project.folders.iter().find(|f| f.id == id));
    if let Some(folder) = first.filter(|f| on_screen_holds(projects, f, path)) {
        return Ok(vec![folder.id.clone()]);
    }
    let others: Vec<&ProjectFolder> = project
        .folders
        .iter()
        .filter(|f| first.is_none_or(|first| first.id != f.id))
        .collect();
    Ok(holding_now(projects, others, path))
}

/// Whether the cached tree of `folder`, the one on screen, holds `path`.
fn on_screen_holds(projects: &Projects, folder: &ProjectFolder, path: &str) -> bool {
    projects
        .reader(&folder.id, Start::Never)
        .and_then(|on| on.reader.file_stamp(&on.info, path))
        .is_ok()
}

/// The ids of `folders` whose tree holds `path` now, in their order: the trees read again side
/// by side, and not kept.
fn holding_now(projects: &Projects, folders: Vec<&ProjectFolder>, path: &str) -> Vec<String> {
    let held: Vec<bool> = std::thread::scope(|scope| {
        let checks: Vec<_> = folders
            .iter()
            .map(|folder| scope.spawn(move || holds_now(projects, folder, path)))
            .collect();
        checks
            .into_iter()
            .map(|check| check.join().unwrap_or(false))
            .collect()
    });
    folders
        .into_iter()
        .zip(held)
        .filter(|(_, held)| *held)
        .map(|(folder, _)| folder.id.clone())
        .collect()
}

/// Whether the tree of `folder`, read again, holds `path`; not when it cannot be read.
fn holds_now(projects: &Projects, folder: &ProjectFolder, path: &str) -> bool {
    projects
        .reader(&folder.id, Start::Never)
        .and_then(|on| on.reader.tree_holds_now(&on.info, path))
        .unwrap_or(false)
}
