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
    /// A folder added to a project is on another machine than its folders (this one, a distro).
    FolderElsewhere,
    /// A folder added to a project is one of its folders, or holds one or is inside one.
    FolderOverlaps,
    GitNotFound,
    GitTimedOut,
    /// The helper that reads a WSL project could not start, or stopped.
    HelperFailed,
    /// An image for a note is bigger than a note takes, in bytes or in pixels.
    ImageTooLarge,
    /// A file given to a note is not an image a note takes (PNG, JPEG, GIF, WebP), or is broken.
    ImageUnsupported,
    InvalidCommit,
    InvalidShortcut,
    NoteListMissing,
    NoteMissing,
    NoteTooLong,
    /// A book's notes do not read, or a newer version of Sidekyk wrote them: never written over.
    NotesUnreadable,
    PathOutsideRepository,
    ProjectNotFound,
    RepositoryMissing,
    /// Sidekyk's other global shortcut has these keys.
    ShortcutInUse,
    ShortcutTaken,
}

impl UserFacingErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DistroMissing => "distro_missing",
            Self::DistroStopped => "distro_stopped",
            Self::ExportInRepository => "export_in_repository",
            Self::FileMissing => "file_missing",
            Self::FolderElsewhere => "folder_elsewhere",
            Self::FolderOverlaps => "folder_overlaps",
            Self::GitNotFound => "git_not_found",
            Self::GitTimedOut => "git_timed_out",
            Self::HelperFailed => "helper_failed",
            Self::ImageTooLarge => "image_too_large",
            Self::ImageUnsupported => "image_unsupported",
            Self::InvalidCommit => "invalid_commit",
            Self::InvalidShortcut => "invalid_shortcut",
            Self::NoteListMissing => "note_list_missing",
            Self::NoteMissing => "note_missing",
            Self::NoteTooLong => "note_too_long",
            Self::NotesUnreadable => "notes_unreadable",
            Self::PathOutsideRepository => "path_outside_repository",
            Self::ProjectNotFound => "project_not_found",
            Self::RepositoryMissing => "repository_missing",
            Self::ShortcutInUse => "shortcut_in_use",
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
        Self::FolderElsewhere,
        Self::FolderOverlaps,
        Self::GitNotFound,
        Self::GitTimedOut,
        Self::HelperFailed,
        Self::ImageTooLarge,
        Self::ImageUnsupported,
        Self::InvalidCommit,
        Self::InvalidShortcut,
        Self::NoteListMissing,
        Self::NoteMissing,
        Self::NoteTooLong,
        Self::NotesUnreadable,
        Self::PathOutsideRepository,
        Self::ProjectNotFound,
        Self::RepositoryMissing,
        Self::ShortcutInUse,
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
            (UserFacingErrorCode::FolderElsewhere, "folder_elsewhere"),
            (UserFacingErrorCode::FolderOverlaps, "folder_overlaps"),
            (UserFacingErrorCode::GitNotFound, "git_not_found"),
            (UserFacingErrorCode::GitTimedOut, "git_timed_out"),
            (UserFacingErrorCode::HelperFailed, "helper_failed"),
            (UserFacingErrorCode::InvalidCommit, "invalid_commit"),
            (UserFacingErrorCode::NoteListMissing, "note_list_missing"),
            (UserFacingErrorCode::NoteMissing, "note_missing"),
            (UserFacingErrorCode::NoteTooLong, "note_too_long"),
            (UserFacingErrorCode::NotesUnreadable, "notes_unreadable"),
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

    #[test]
    fn shortcut_error_codes_keep_the_wire_contract() {
        let cases = [
            (UserFacingErrorCode::InvalidShortcut, "invalid_shortcut"),
            (UserFacingErrorCode::ShortcutInUse, "shortcut_in_use"),
            (UserFacingErrorCode::ShortcutTaken, "shortcut_taken"),
        ];
        for (code, wire) in cases {
            assert_eq!(code.as_str(), wire);
            assert_eq!(UserFacingErrorCode::parse(wire), Some(code));
        }
    }
}
