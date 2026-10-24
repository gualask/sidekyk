use std::path::{Path, PathBuf};

use super::contracts::RepositoryInfo;
use super::ports::RepositoryBackend;
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
