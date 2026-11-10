use std::path::{Path, PathBuf};

use super::contracts::RepositoryInfo;
use super::ports::RepositoryBackend;
use super::tree::compare_names;
use super::{folder_kind, FolderKind};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// Two paths, one per line.
const MAX_REV_PARSE_BYTES: usize = 64 * 1024;

pub struct ResolvedRepository {
    pub info: RepositoryInfo,
    /// Usually `<root>/.git`; elsewhere for linked worktrees and submodules.
    pub git_dir: PathBuf,
}

/// What the app calls the repository at `root`: the name of its folder.
pub fn repository_name(root: &str) -> String {
    Path::new(root)
        .file_name()
        .map_or_else(|| root.to_string(), |n| n.to_string_lossy().into_owned())
}

/// The root of a repository the app knows, if it is still there. A repository moved or deleted
/// since it was added is reported as such, before git fails on a folder that does not exist.
pub fn existing_root<'a>(
    backend: &dyn RepositoryBackend,
    repository: &'a RepositoryInfo,
) -> anyhow::Result<&'a Path> {
    let root = Path::new(&repository.root);
    existing_folder(backend, root)?;
    Ok(root)
}

/// Whether a project's folder is still there: one moved or deleted is `repository_missing`.
pub fn existing_folder(backend: &dyn RepositoryBackend, root: &Path) -> anyhow::Result<()> {
    if backend.is_dir(root) {
        Ok(())
    } else {
        Err(user_facing(UserFacingErrorCode::RepositoryMissing))
    }
}

/// Finds the repository that contains `candidate`, which can be any folder inside it.
pub fn resolve_repository(
    backend: &dyn RepositoryBackend,
    candidate: &Path,
) -> anyhow::Result<ResolvedRepository> {
    existing_folder(backend, candidate)?;
    let out = backend.git(
        candidate,
        &["rev-parse", "--show-toplevel", "--absolute-git-dir"],
        MAX_REV_PARSE_BYTES,
    )?;
    if out.code != 0 {
        anyhow::bail!("git finds no repository: {}", out.stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut lines = stdout.lines();
    let (Some(root), Some(git_dir)) = (lines.next(), lines.next()) else {
        anyhow::bail!("git named no root or git dir");
    };
    Ok(ResolvedRepository {
        info: RepositoryInfo {
            root: root.to_string(),
            name: repository_name(root),
        },
        git_dir: PathBuf::from(git_dir),
    })
}

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
