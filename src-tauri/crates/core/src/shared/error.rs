use serde::ser::SerializeStruct;
use std::fmt;

/// Top-level error type returned by Tauri commands.
///
/// The frontend receives a stable payload `{ code, message }` via the custom `Serialize`
/// implementation below.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Anyhow(#[from] anyhow::Error),
}

/// Stable codes understood by the frontend's user-facing error formatter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserFacingErrorCode {
    /// A WSL project's distro is not installed, or WSL is not.
    DistroMissing,
    /// A WSL project's distro does not run, and a summary does not start it.
    DistroStopped,
    ExportInRepository,
    FileMissing,
    GitNotFound,
    GitTimedOut,
    /// The helper that reads a WSL project could not start, or stopped.
    HelperFailed,
    InvalidCommit,
    #[cfg(any(target_os = "macos", windows))]
    InvalidShortcut,
    NoteListMissing,
    NoteMissing,
    NoteTooLong,
    PathOutsideRepository,
    ProjectNotFound,
    RepositoryMissing,
    #[cfg(any(target_os = "macos", windows))]
    ShortcutTaken,
}

impl UserFacingErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DistroMissing => "distro_missing",
            Self::DistroStopped => "distro_stopped",
            Self::ExportInRepository => "export_in_repository",
            Self::FileMissing => "file_missing",
            Self::GitNotFound => "git_not_found",
            Self::GitTimedOut => "git_timed_out",
            Self::HelperFailed => "helper_failed",
            Self::InvalidCommit => "invalid_commit",
            #[cfg(any(target_os = "macos", windows))]
            Self::InvalidShortcut => "invalid_shortcut",
            Self::NoteListMissing => "note_list_missing",
            Self::NoteMissing => "note_missing",
            Self::NoteTooLong => "note_too_long",
            Self::PathOutsideRepository => "path_outside_repository",
            Self::ProjectNotFound => "project_not_found",
            Self::RepositoryMissing => "repository_missing",
            #[cfg(any(target_os = "macos", windows))]
            Self::ShortcutTaken => "shortcut_taken",
        }
    }

    /// The code `as_str` gives, back: an error that crossed a process boundary (the helper's).
    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|c| c.as_str() == code)
    }

    const ALL: &[Self] = &[
        Self::DistroMissing,
        Self::DistroStopped,
        Self::ExportInRepository,
        Self::FileMissing,
        Self::GitNotFound,
        Self::GitTimedOut,
        Self::HelperFailed,
        Self::InvalidCommit,
        #[cfg(any(target_os = "macos", windows))]
        Self::InvalidShortcut,
        Self::NoteListMissing,
        Self::NoteMissing,
        Self::NoteTooLong,
        Self::PathOutsideRepository,
        Self::ProjectNotFound,
        Self::RepositoryMissing,
        #[cfg(any(target_os = "macos", windows))]
        Self::ShortcutTaken,
    ];
}

/// An error intended to be surfaced to the user (via a stable error `code`).
///
/// Wrap this inside `anyhow::Error` so it can carry context while still producing a
/// frontend-friendly `{ code, message }` payload.
#[derive(Debug)]
pub struct UserFacingError {
    pub code: UserFacingErrorCode,
}

impl UserFacingError {
    pub fn new(code: UserFacingErrorCode) -> Self {
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
pub fn user_facing(code: UserFacingErrorCode) -> anyhow::Error {
    anyhow::Error::new(UserFacingError::new(code))
}

/// The user-facing code `err` carries, if any: `None` means an unexpected failure.
pub fn user_facing_code(err: &anyhow::Error) -> Option<UserFacingErrorCode> {
    err.downcast_ref::<UserFacingError>().map(|user| user.code)
}

/// The code a failure is told by: its user-facing one, or `unknown`.
pub fn wire_code(err: &anyhow::Error) -> &'static str {
    user_facing_code(err).map_or("unknown", UserFacingErrorCode::as_str)
}

/// A failure made again from its code and message (`{err:#}`), as one shared or sent from another
/// process: both are kept, the message for the log.
pub fn rebuilt(code: Option<UserFacingErrorCode>, message: &str) -> anyhow::Error {
    let Some(code) = code else {
        return anyhow::anyhow!("{message}");
    };
    let cause = message
        .strip_prefix(code.as_str())
        .map(|rest| rest.trim_start_matches(": "));
    match cause {
        Some("") => user_facing(code),
        Some(cause) => anyhow::anyhow!("{cause}").context(UserFacingError::new(code)),
        None => anyhow::anyhow!("{message}").context(UserFacingError::new(code)),
    }
}

/// An error shared by several callers (see `Coalesced`), back as an owned error that keeps its
/// user-facing code.
pub fn unshare(err: std::sync::Arc<anyhow::Error>) -> anyhow::Error {
    std::sync::Arc::try_unwrap(err)
        .unwrap_or_else(|shared| rebuilt(user_facing_code(&shared), &format!("{shared:#}")))
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let AppError::Anyhow(err) = self;
        let code = wire_code(err);

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
        let known = AppError::from(user_facing(UserFacingErrorCode::RepositoryMissing));
        assert_eq!(
            serde_json::to_value(known).unwrap(),
            serde_json::json!({ "code": "repository_missing", "message": "repository_missing" })
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
    fn a_rebuilt_error_keeps_its_code_and_its_cause() {
        let error = anyhow::anyhow!("wsl.exe timed out")
            .context(UserFacingError::new(UserFacingErrorCode::HelperFailed));
        let again = rebuilt(
            Some(UserFacingErrorCode::HelperFailed),
            &format!("{error:#}"),
        );
        assert_eq!(
            user_facing_code(&again),
            Some(UserFacingErrorCode::HelperFailed)
        );
        assert_eq!(format!("{again:#}"), "helper_failed: wsl.exe timed out");
        let bare = rebuilt(Some(UserFacingErrorCode::FileMissing), "file_missing");
        assert_eq!(format!("{bare:#}"), "file_missing");
    }

    #[test]
    fn user_facing_error_codes_keep_the_wire_contract() {
        let cases = [
            (UserFacingErrorCode::DistroMissing, "distro_missing"),
            (UserFacingErrorCode::DistroStopped, "distro_stopped"),
            (
                UserFacingErrorCode::ExportInRepository,
                "export_in_repository",
            ),
            (UserFacingErrorCode::FileMissing, "file_missing"),
            (UserFacingErrorCode::GitNotFound, "git_not_found"),
            (UserFacingErrorCode::GitTimedOut, "git_timed_out"),
            (UserFacingErrorCode::HelperFailed, "helper_failed"),
            (UserFacingErrorCode::InvalidCommit, "invalid_commit"),
            (UserFacingErrorCode::NoteListMissing, "note_list_missing"),
            (UserFacingErrorCode::NoteMissing, "note_missing"),
            (UserFacingErrorCode::NoteTooLong, "note_too_long"),
            (
                UserFacingErrorCode::PathOutsideRepository,
                "path_outside_repository",
            ),
            (UserFacingErrorCode::ProjectNotFound, "project_not_found"),
            (UserFacingErrorCode::RepositoryMissing, "repository_missing"),
        ];
        for (code, wire) in cases {
            assert_eq!(code.as_str(), wire);
            assert_eq!(UserFacingErrorCode::parse(wire), Some(code));
        }
        assert_eq!(UserFacingErrorCode::parse("unknown"), None);
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
            assert_eq!(UserFacingErrorCode::parse(wire), Some(code));
        }
    }
}
