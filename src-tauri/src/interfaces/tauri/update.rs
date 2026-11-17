//! The app's own updates (`desktop/update.rs`): a check, and the install of what it found.

use sidekyk_core::shared::error::AppError;
use tauri::{AppHandle, Emitter};

use crate::desktop::update;

/// Each whole percent of an update downloaded, `null` when the size is unknown.
const UPDATE_PROGRESS_EVENT: &str = "update-progress";

#[tauri::command]
/// A version newer than this one on the release server, or none.
pub(crate) async fn check_update(app: AppHandle) -> Result<Option<String>, AppError> {
    Ok(update::check(&app).await?)
}

#[tauri::command]
/// Installs the version `check_update` found and restarts the app; the page hears the download's
/// progress meanwhile.
pub(crate) async fn install_update(app: AppHandle) -> Result<(), AppError> {
    let page = app.clone();
    update::install(&app, move |percent| {
        let _ = page.emit(UPDATE_PROGRESS_EVENT, percent);
    })
    .await?;
    Ok(())
}
