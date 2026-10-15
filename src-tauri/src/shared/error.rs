use serde::ser::SerializeStruct;
use std::fmt;

/// Top-level error type returned by Tauri commands.
///
/// The frontend receives a stable payload `{ code, message }` via the custom `Serialize`
/// implementation below.
#[derive(Debug, thiserror::Error)]
pub(crate) enum AppError {
    #[error(transparent)]
    Anyhow(#[from] anyhow::Error),
}

/// Stable codes understood by the frontend's user-facing error formatter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UserFacingErrorCode {
    GitNotFound,
    GitTimedOut,
    InvalidCommit,
    #[cfg(any(target_os = "macos", windows))]
    InvalidShortcut,
    NotARepository,
    PathOutsideRepository,
    ProjectNotFound,
    RepositoryMissing,
    #[cfg(any(target_os = "macos", windows))]
    ShortcutTaken,
}

impl UserFacingErrorCode {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::GitNotFound => "git_not_found",
            Self::GitTimedOut => "git_timed_out",
            Self::InvalidCommit => "invalid_commit",
            #[cfg(any(target_os = "macos", windows))]
            Self::InvalidShortcut => "invalid_shortcut",
            Self::NotARepository => "not_a_repository",
            Self::PathOutsideRepository => "path_outside_repository",
            Self::ProjectNotFound => "project_not_found",
            Self::RepositoryMissing => "repository_missing",
            #[cfg(any(target_os = "macos", windows))]
            Self::ShortcutTaken => "shortcut_taken",
        }
    }
}

/// An error intended to be surfaced to the user (via a stable error `code`).
///
/// Wrap this inside `anyhow::Error` so it can carry context while still producing a
/// frontend-friendly `{ code, message }` payload.
#[derive(Debug)]
pub(crate) struct UserFacingError {
    pub(crate) code: UserFacingErrorCode,
}

impl UserFacingError {
    pub(crate) fn new(code: UserFacingErrorCode) -> Self {
        Self { code }
    }
}

impl fmt::Display for UserFacingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code.as_str())
    }
}

impl std::error::Error for UserFacingError {}

/// Shorthand for an `anyhow::Error` carrying a user-facing code.
pub(crate) fn user_facing(code: UserFacingErrorCode) -> anyhow::Error {
    anyhow::Error::new(UserFacingError::new(code))
}

/// The user-facing code `err` carries, if any: `None` means an unexpected failure.
pub(crate) fn user_facing_code(err: &anyhow::Error) -> Option<UserFacingErrorCode> {
    err.downcast_ref::<UserFacingError>().map(|user| user.code)
}

/// An error shared by several callers (see `Coalesced`), back as an owned error that keeps its
/// user-facing code.
pub(crate) fn unshare(err: std::sync::Arc<anyhow::Error>) -> anyhow::Error {
    std::sync::Arc::try_unwrap(err).unwrap_or_else(|shared| match user_facing_code(&shared) {
        Some(code) => user_facing(code),
        None => anyhow::anyhow!("{shared:#}"),
    })
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let AppError::Anyhow(err) = self;
        let code = user_facing_code(err).map_or("unknown", UserFacingErrorCode::as_str);

        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", code)?;
        st.serialize_field("message", &format!("{err:#}"))?;
        st.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_user_facing_codes_and_unknown_errors() {
        let known = AppError::from(user_facing(UserFacingErrorCode::NotARepository));
        assert_eq!(
            serde_json::to_value(known).unwrap(),
            serde_json::json!({ "code": "not_a_repository", "message": "not_a_repository" })
        );

        let unknown = AppError::from(anyhow::anyhow!("git exploded"));
        assert_eq!(
            serde_json::to_value(unknown).unwrap(),
            serde_json::json!({ "code": "unknown", "message": "git exploded" })
        );
    }

    #[test]
    fn a_shared_error_keeps_its_code_and_message() {
        let shared = std::sync::Arc::new(user_facing(UserFacingErrorCode::ProjectNotFound));
        let _other_caller = shared.clone();
        assert_eq!(
            serde_json::to_value(AppError::from(unshare(shared))).unwrap(),
            serde_json::json!({ "code": "project_not_found", "message": "project_not_found" })
        );

        let shared = std::sync::Arc::new(anyhow::anyhow!("git exploded").context("snapshot"));
        let _other_caller = shared.clone();
        assert_eq!(
            serde_json::to_value(AppError::from(unshare(shared))).unwrap(),
            serde_json::json!({ "code": "unknown", "message": "snapshot: git exploded" })
        );
    }

    #[test]
    fn user_facing_error_codes_keep_the_wire_contract() {
        let cases = [
            (UserFacingErrorCode::GitNotFound, "git_not_found"),
            (UserFacingErrorCode::GitTimedOut, "git_timed_out"),
            (UserFacingErrorCode::InvalidCommit, "invalid_commit"),
            (UserFacingErrorCode::NotARepository, "not_a_repository"),
            (
                UserFacingErrorCode::PathOutsideRepository,
                "path_outside_repository",
            ),
            (UserFacingErrorCode::ProjectNotFound, "project_not_found"),
            (UserFacingErrorCode::RepositoryMissing, "repository_missing"),
        ];
        for (code, wire) in cases {
            assert_eq!(code.as_str(), wire);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn shortcut_error_codes_keep_the_wire_contract() {
        let cases = [
            (UserFacingErrorCode::InvalidShortcut, "invalid_shortcut"),
            (UserFacingErrorCode::ShortcutTaken, "shortcut_taken"),
        ];
        for (code, wire) in cases {
            assert_eq!(code.as_str(), wire);
        }
    }
}
