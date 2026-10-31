use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::Instant;

use sidekyk_core::shared::error::{user_facing_code, AppError};
use sidekyk_core::shared::sync::lock;

/// The failures logged, until their command next succeeds: a read that fails on every refresh,
/// up to once a second while an agent writes, writes one line, not one a second.
static LOGGED: Mutex<Failures> = Mutex::new(Failures(BTreeSet::new()));

/// More failures kept than this start over: what repeats is logged again, within the file's cap.
const MAX_KEPT: usize = 1_000;

/// Runs blocking work (git, the file system, a dialog) off the async runtime, and logs how long it
/// took and how it failed.
pub(super) async fn blocking<T: Send + 'static>(
    command: &'static str,
    app: tauri::AppHandle,
    work: impl FnOnce(&tauri::AppHandle) -> anyhow::Result<T> + Send + 'static,
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
        Err(error) => {
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
    }
    result.map_err(AppError::from)
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
