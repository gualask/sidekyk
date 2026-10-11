//! Persisted settings through `tauri-plugin-store`.

use std::path::PathBuf;

use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const LAST_REPOSITORY_KEY: &str = "lastRepository";

pub(crate) fn load_last_repository(app: &tauri::AppHandle) -> Option<PathBuf> {
    let store = app.store(STORE_FILE).ok()?;
    store.get(LAST_REPOSITORY_KEY)?.as_str().map(PathBuf::from)
}

pub(crate) fn save_last_repository(app: &tauri::AppHandle, root: &str) -> anyhow::Result<()> {
    let store = app.store(STORE_FILE)?;
    store.set(LAST_REPOSITORY_KEY, root);
    store.save()?;
    Ok(())
}
