//! Persisted settings through `tauri-plugin-store`.

use tauri_plugin_store::StoreExt;

use crate::modules::projects::ProjectList;
use crate::modules::repository::{repository_name, RepositoryInfo};

const STORE_FILE: &str = "settings.json";
const PROJECTS_KEY: &str = "projects";
/// Before projects, the app remembered only the last repository it showed.
const LAST_REPOSITORY_KEY: &str = "lastRepository";

/// The stored projects, or the last repository of an older version as the only one.
pub(crate) fn load_projects(app: &tauri::AppHandle) -> ProjectList {
    let Ok(store) = app.store(STORE_FILE) else {
        return ProjectList::default();
    };
    if let Some(stored) = store.get(PROJECTS_KEY) {
        return match serde_json::from_value::<ProjectList>(stored) {
            Ok(list) => list.normalized(),
            Err(error) => {
                tracing::warn!(%error, "could not read the stored projects");
                ProjectList::default()
            }
        };
    }
    let mut list = ProjectList::default();
    let last = store.get(LAST_REPOSITORY_KEY);
    if let Some(root) = last.as_ref().and_then(|root| root.as_str()) {
        list.add(RepositoryInfo {
            root: root.to_string(),
            name: repository_name(root),
        });
        if let Err(error) = save_projects(app, &list) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the projects");
        }
    }
    list
}

pub(crate) fn save_projects(app: &tauri::AppHandle, list: &ProjectList) -> anyhow::Result<()> {
    let store = app.store(STORE_FILE)?;
    store.set(PROJECTS_KEY, serde_json::to_value(list)?);
    store.delete(LAST_REPOSITORY_KEY);
    store.save()?;
    Ok(())
}
