//! Links the frontend opens outside the app: a Markdown preview's web and mail addresses.

use sidekyk_core::modules::preview::is_web_url;
use sidekyk_core::shared::error::AppError;
use tauri_plugin_opener::OpenerExt;

use super::blocking::blocking;

#[tauri::command]
/// A web or mail address in the system's browser or mail app. Any other scheme is refused, so a
/// file's link never opens a file or starts another app.
pub(crate) async fn open_url(app: tauri::AppHandle, url: String) -> Result<(), AppError> {
    blocking("open_url", app, move |app| {
        anyhow::ensure!(is_web_url(&url), "not a web or mail address");
        app.opener().open_url(url, None::<&str>)?;
        Ok(())
    })
    .await
}
