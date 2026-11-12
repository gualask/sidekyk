//! How a command reaches its work: off the async runtime, logged; on a folder by its id, on a
//! book's notes, through the core's ports whose adapters `bootstrap` chose.

use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::Instant;

use tauri::{AppHandle, Manager};

use sidekyk_core::app::machines::Start;
use sidekyk_core::app::notes::{ExportFiles, Notes};
use sidekyk_core::app::projects::{FolderReader, Projects};
use sidekyk_core::modules::notes::{Book, GivenFiles, NotesStorage, NotesStore};
use sidekyk_core::shared::error::{user_facing_code, AppError};
use sidekyk_core::shared::sync::lock;

/// What the commands reach through the core's ports, each adapter chosen by `bootstrap`.
pub(crate) struct Ports {
    /// Where the notes are kept.
    pub(crate) notes: Box<dyn NotesStorage>,
    /// Files of this host given to a note.
    pub(crate) given: Box<dyn GivenFiles>,
    /// Files of this host an export writes.
    pub(crate) export: Box<dyn ExportFiles>,
}

pub(super) fn ports(app: &AppHandle) -> &Ports {
    app.state::<Ports>().inner()
}

/// The failures logged, until their command next succeeds: a read that fails on every refresh,
/// up to once a second while an agent writes, writes one line, not one a second.
static LOGGED: Mutex<Failures> = Mutex::new(Failures(BTreeSet::new()));

/// More failures kept than this start over: what repeats is logged again, within the file's cap.
const MAX_KEPT: usize = 1_000;

/// Runs blocking work (git, the file system, a dialog) off the async runtime, and logs how long it
/// took and how it failed.
pub(super) async fn blocking<T: Send + 'static>(
    command: &'static str,
    app: AppHandle,
    work: impl FnOnce(&AppHandle) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    let started = Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || work(&app))
        .await
        .map_err(anyhow::Error::from)
        .and_then(|result| result);
    let ms = started.elapsed().as_millis() as u64;
    match &result {
        Ok(_) => {
            lock(&LOGGED).succeeded(command);
            tracing::debug!(command, ms, "command");
        }
        Err(error) => log_failure(command, ms, error),
    }
    result.map_err(AppError::from)
}

/// Logs a command's failure: at `debug` when it repeats, at `info` when the UI shows it, else at
/// `error`.
fn log_failure(command: &'static str, ms: u64, error: &anyhow::Error) {
    let error_text = format!("{error:#}");
    if !lock(&LOGGED).is_new(command, &error_text) {
        tracing::debug!(command, ms, error = error_text, "command failed again");
    } else if let Some(code) = user_facing_code(error) {
        // Expected states such as a folder outside any repository: the UI shows them,
        // with their cause, such as why a WSL helper did not start.
        tracing::info!(
            command,
            ms,
            code = code.as_str(),
            error = error_text,
            "command refused"
        );
    } else {
        tracing::error!(command, ms, error = error_text, "command failed");
    }
}

/// Runs `work` off the async runtime on a folder of a project the user added, with what reads it,
/// once `start` allows it: `Start::Never` fails `distro_stopped` for a stopped WSL distro.
pub(super) async fn on_folder<T: Send + 'static>(
    command: &'static str,
    app: AppHandle,
    folder_id: String,
    start: Start,
    work: impl FnOnce(FolderReader) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        work(app.state::<Projects>().reader(&folder_id, start)?)
    })
    .await
}

/// The notes of the list's books, as the app keeps them.
pub(super) fn notes(app: &AppHandle) -> Notes<'_> {
    Notes::new(
        app.state::<Projects>().inner(),
        app.state::<NotesStore>().inner(),
        &*ports(app).notes,
    )
}

/// Runs `work` with the notes and where they are kept, off the async runtime.
pub(super) async fn with_store<T: Send + 'static>(
    command: &'static str,
    app: AppHandle,
    work: impl FnOnce(&AppHandle, &NotesStore, &dyn NotesStorage) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    blocking(command, app, move |app| {
        work(app, &app.state::<NotesStore>(), &*ports(app).notes)
    })
    .await
}

/// Runs `work` on a book's notes, once the book is known.
pub(super) async fn with_notes<T: Send + 'static>(
    command: &'static str,
    app: AppHandle,
    book: String,
    work: impl FnOnce(&NotesStore, &dyn NotesStorage, &Book) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, AppError> {
    with_store(command, app, move |app, store, files| {
        work(store, files, &notes(app).book(&book)?)
    })
    .await
}

/// Each command's failures logged, by message.
struct Failures(BTreeSet<(&'static str, String)>);

impl Failures {
    /// Whether this failure is new: not logged since its command last succeeded.
    fn is_new(&mut self, command: &'static str, error: &str) -> bool {
        if self.0.len() >= MAX_KEPT {
            self.0.clear();
        }
        self.0.insert((command, error.to_string()))
    }

    /// The command succeeded: its failures are logged again when they come back.
    fn succeeded(&mut self, command: &'static str) {
        if !self.0.is_empty() {
            self.0.retain(|(failed, _)| *failed != command);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failure_is_logged_once_until_its_command_succeeds() {
        let mut logged = Failures(BTreeSet::new());
        assert!(logged.is_new("get_repository_snapshot", "git: not a repository"));
        assert!(!logged.is_new("get_repository_snapshot", "git: not a repository"));
        // another message, or the same from another command, is new
        assert!(logged.is_new("get_repository_snapshot", "git timed out"));
        assert!(logged.is_new("get_file_diff", "git timed out"));

        // another command succeeding forgets nothing of this one
        logged.succeeded("get_file_diff");
        assert!(!logged.is_new("get_repository_snapshot", "git timed out"));
        logged.succeeded("get_repository_snapshot");
        assert!(logged.is_new("get_repository_snapshot", "git: not a repository"));
        assert!(logged.is_new("get_file_diff", "git timed out"));
    }
}
