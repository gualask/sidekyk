use std::path::{Path, PathBuf};

use super::contracts::RepositoryInfo;
use super::ports::RepositoryBackend;
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// Two paths, one per line.
const MAX_REV_PARSE_BYTES: usize = 64 * 1024;

pub(crate) struct ResolvedRepository {
    pub(crate) info: RepositoryInfo,
    /// Usually `<root>/.git`; elsewhere for linked worktrees and submodules.
    pub(crate) git_dir: PathBuf,
}

/// What the app calls the repository at `root`: the name of its folder.
pub(crate) fn repository_name(root: &str) -> String {
    Path::new(root)
        .file_name()
        .map_or_else(|| root.to_string(), |n| n.to_string_lossy().into_owned())
}

/// The root of a repository the app knows, if it is still there. A repository moved or deleted
/// since it was added is reported as such, before git fails on a folder that does not exist.
pub(crate) fn existing_root(repository: &RepositoryInfo) -> anyhow::Result<&Path> {
    let root = Path::new(&repository.root);
    if root.is_dir() {
        Ok(root)
    } else {
        Err(user_facing(UserFacingErrorCode::RepositoryMissing))
    }
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
        MAX_REV_PARSE_BYTES,
    )?;
    if out.code != 0 {
        return Err(user_facing(UserFacingErrorCode::NotARepository));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut lines = stdout.lines();
    let (Some(root), Some(git_dir)) = (lines.next(), lines.next()) else {
        return Err(user_facing(UserFacingErrorCode::NotARepository));
    };
    Ok(ResolvedRepository {
        info: RepositoryInfo {
            root: root.to_string(),
            name: repository_name(root),
        },
        git_dir: PathBuf::from(git_dir),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::error::user_facing_code;

    #[test]
    fn a_repository_moved_away_is_reported_as_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let repository = RepositoryInfo {
            name: repository_name(&root),
            root,
        };
        assert!(existing_root(&repository).is_ok());

        drop(dir);
        let error = existing_root(&repository).unwrap_err();
        assert_eq!(
            user_facing_code(&error),
            Some(UserFacingErrorCode::RepositoryMissing)
        );
    }
}
