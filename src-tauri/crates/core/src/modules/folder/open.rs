use std::path::{Path, PathBuf};

use super::{folder_kind, FolderKind};
use crate::modules::repository::{
    compare_names, existing_folder, repository_name, resolve_repository, RepositoryBackend,
    RepositoryInfo,
};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// The folder a project takes for `candidate`, its real path: the repository that holds it when a
/// `.git` is at or above it, else `candidate` itself. Git runs only then, so a folder without git
/// is taken without it (on macOS without the Command Line Tools, `/usr/bin/git` asks to install
/// them).
pub fn resolve_folder(
    backend: &dyn RepositoryBackend,
    candidate: &Path,
) -> anyhow::Result<RepositoryInfo> {
    existing_folder(backend, candidate)?;
    // gone between the two looks
    let folder = backend
        .real_path(candidate)
        .ok_or_else(|| user_facing(UserFacingErrorCode::RepositoryMissing))?;
    let holding = folder
        .ancestors()
        .find(|above| matches!(folder_kind(backend, above), Ok(FolderKind::Repository)));
    let root = match holding {
        // as git names it; a `.git` git refuses (broken, git missing) still makes the root, whose
        // reads then fail as a broken repository's do
        Some(holding) => resolve_repository(backend, &folder).map_or_else(
            |_| holding.to_path_buf(),
            |found| PathBuf::from(found.info.root),
        ),
        None => folder,
    };
    let root = root
        .into_os_string()
        .into_string()
        .map_err(|_| anyhow::anyhow!("the folder's path is not Unicode"))?;
    Ok(RepositoryInfo {
        name: repository_name(&root),
        root,
    })
}

/// The repositories right inside `folder`, a folder without git, by name: each subfolder with a
/// `.git` at its root, links not followed. A folder picked above several repositories (api, web)
/// finds them, as VS Code looks one level down by default; none for a repository.
pub fn repositories_inside(
    backend: &dyn RepositoryBackend,
    folder: &Path,
) -> anyhow::Result<Vec<RepositoryInfo>> {
    if folder_kind(backend, folder)? == FolderKind::Repository {
        return Ok(Vec::new());
    }
    let mut found: Vec<RepositoryInfo> = backend
        .folders(folder, Path::new(""))
        .unwrap_or_default()
        .into_iter()
        .filter(|name| backend.has_entry(&folder.join(name), Path::new(".git")))
        .filter_map(|name| {
            let root = folder.join(name).into_os_string().into_string().ok()?;
            Some(RepositoryInfo {
                name: repository_name(&root),
                root,
            })
        })
        .collect();
    found.sort_by(|a, b| compare_names(&a.name, &b.name));
    Ok(found)
}
