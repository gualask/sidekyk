use std::path::{Path, PathBuf};

use super::contracts::RepositoryInfo;
use super::ports::RepositoryBackend;
use crate::shared::error::{user_facing, UserFacingErrorCode};

pub(crate) struct ResolvedRepository {
    pub(crate) info: RepositoryInfo,
    /// Usually `<root>/.git`; elsewhere for linked worktrees and submodules.
    pub(crate) git_dir: PathBuf,
}

/// Finds the repository that contains `candidate`, which can be any folder inside it.
pub(crate) fn resolve_repository(
    backend: &dyn RepositoryBackend,
    candidate: &Path,
) -> anyhow::Result<ResolvedRepository> {
    if !candidate.is_dir() {
        return Err(user_facing(UserFacingErrorCode::NotARepository));
    }
    let out = backend.git(
        candidate,
        &["rev-parse", "--show-toplevel", "--absolute-git-dir"],
    )?;
    if out.code != 0 {
        return Err(user_facing(UserFacingErrorCode::NotARepository));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut lines = stdout.lines();
    let (Some(root), Some(git_dir)) = (lines.next(), lines.next()) else {
        return Err(user_facing(UserFacingErrorCode::NotARepository));
    };
    let name = Path::new(root)
        .file_name()
        .map_or_else(|| root.to_string(), |n| n.to_string_lossy().into_owned());

    Ok(ResolvedRepository {
        info: RepositoryInfo {
            root: root.to_string(),
            name,
        },
        git_dir: PathBuf::from(git_dir),
    })
}
