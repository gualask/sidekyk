use std::time::Instant;

use crate::shared::error::{user_facing_code, AppError};

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
        Ok(_) => tracing::debug!(command, ms, "command"),
        Err(error) => match user_facing_code(error) {
            // Expected states such as a folder outside any repository: the UI shows them.
            Some(code) => tracing::info!(command, ms, code = code.as_str(), "command refused"),
            None => tracing::error!(command, ms, error = %format!("{error:#}"), "command failed"),
        },
    }
    result.map_err(AppError::from)
}
