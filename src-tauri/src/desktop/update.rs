//! The app's own updates: the newer version a check found on the release server, installed when
//! the user asks, one install at a time. The updater plugin downloads it, checks its signature
//! against the key in `tauri.conf.json` and puts it in place of the app.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use sidekyk_core::shared::sync::lock;

#[derive(Default)]
pub(crate) struct Updates {
    /// What the last check found, for the install.
    found: Mutex<Option<Update>>,
    installing: AtomicBool,
}

/// Asks the release server for a version newer than this one: its number, or none. A
/// development build (`tauri dev`) has nothing to update.
pub(crate) async fn check(app: &AppHandle) -> anyhow::Result<Option<String>> {
    if tauri::is_dev() {
        return Ok(None);
    }
    let update = app.updater()?.check().await?;
    let version = update.as_ref().map(|update| update.version.clone());
    if let Some(version) = &version {
        // at most once a day, when there is one
        tracing::info!(version, "update available");
    }
    *lock(&app.state::<Updates>().found) = update;
    Ok(version)
}

/// Downloads the version the last check found, installs it in place of the app and starts it.
/// `progress` hears each whole percent downloaded, or `None` once when the server gives no size.
/// A second call while one installs does nothing. On Windows the update's installer takes over
/// and the app exits.
pub(crate) async fn install(
    app: &AppHandle,
    mut progress: impl FnMut(Option<u8>),
) -> anyhow::Result<()> {
    let updates = app.state::<Updates>();
    let Some(update) = lock(&updates.found).clone() else {
        anyhow::bail!("no update to install: check again");
    };
    if updates.installing.swap(true, Ordering::Relaxed) {
        return Ok(());
    }
    tracing::info!(version = update.version, "installing update");
    let mut downloaded = 0u64;
    let mut told = None;
    let result = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let percent = total.map(|total| percent_of(downloaded, total));
                if told != Some(percent) {
                    told = Some(percent);
                    progress(percent);
                }
            },
            || {},
        )
        .await;
    updates.installing.store(false, Ordering::Relaxed);
    if let Err(error) = result {
        tracing::warn!(%error, "update not installed");
        return Err(error.into());
    }
    app.restart()
}

/// `part` of `total` as a whole percent, at most 100.
fn percent_of(part: u64, total: u64) -> u8 {
    if total == 0 {
        return 100;
    }
    (part.min(total) * 100 / total) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percents_are_whole_and_bounded() {
        assert_eq!(percent_of(0, 200), 0);
        assert_eq!(percent_of(199, 200), 99);
        assert_eq!(percent_of(200, 200), 100);
        assert_eq!(percent_of(300, 200), 100);
        assert_eq!(percent_of(5, 0), 100);
    }
}
