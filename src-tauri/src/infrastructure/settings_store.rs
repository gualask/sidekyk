//! The settings and the projects, in one JSON file of the app's data folder (`settings.json`):
//! `settings`, `projects`, and `lastRepository` from before projects, each read on its own. Each
//! is read for what reads and written back with only what changed (`stored_json`), so another
//! version's values stay.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::Manager;

use sidekyk_core::modules::projects::{Location, Project, ProjectList};
use sidekyk_core::modules::repository::repository_name;
use sidekyk_core::modules::settings::Settings;
use sidekyk_core::shared::sync::lock;

use super::files::{read_within, write_whole};
use super::stored_json::{read_lenient, with_changes};

const STORE_FILE: &str = "settings.json";
/// Where a file that cannot be read is set aside, replacing one set aside before.
const UNREADABLE_FILE: &str = "settings.unreadable.json";
/// Bounds the read: the file holds settings and a list of projects, a few KiB.
const MAX_BYTES: u64 = 4 * 1024 * 1024;
const SETTINGS_KEY: &str = "settings";
const PROJECTS_KEY: &str = "projects";
/// Before projects, the app remembered only the last repository it showed.
const LAST_REPOSITORY_KEY: &str = "lastRepository";

/// The file as last read or written, its values by key. Each change writes it whole, under the
/// lock, so changes reach the disk in their order.
pub(crate) struct SettingsFile {
    path: PathBuf,
    contents: Mutex<Contents>,
}

struct Contents {
    /// As stored, each value as another version may have written it.
    values: Map<String, Value>,
    /// What this version read of each value, or wrote last: a write stores the changes from it.
    read: Map<String, Value>,
    /// False when the file could be neither read nor set aside: it is never written over, so
    /// nothing the user had is lost to the defaults of one session.
    writable: bool,
}

impl SettingsFile {
    /// Reads the file in the app's data folder `data`: none yet, nothing stored. One whose text
    /// does not read (edited by hand) is set aside, beside it, and the app starts from the
    /// defaults; one the disk does not give (a lock, a permission) stays where it is, never
    /// written over this session.
    pub(crate) fn open(data: &Path) -> Self {
        let path = data.join(STORE_FILE);
        let contents = match read_within(&path, MAX_BYTES) {
            Ok(None) => Contents::new(Map::new(), true),
            Ok(Some(bytes)) => match serde_json::from_slice(&bytes) {
                Ok(values) => Contents::new(values, true),
                Err(error) => Contents::new(Map::new(), set_aside(&path, &error)),
            },
            Err(error) => {
                tracing::error!(
                    error = %format!("{error:#}"),
                    "the settings could not be read: the defaults in use, not written this session"
                );
                Contents::new(Map::new(), false)
            }
        };
        Self {
            path,
            contents: Mutex::new(contents),
        }
    }

    /// The value stored under `key`, as stored.
    fn get(&self, key: &str) -> Option<Value> {
        lock(&self.contents).values.get(key).cloned()
    }

    /// The value stored under `key` as `read` makes it, none when nothing is stored: what it
    /// made is what the next write of `key` stores the changes from.
    fn read<T: Serialize>(&self, key: &str, read: impl FnOnce(&Value) -> T) -> Option<T> {
        let mut contents = lock(&self.contents);
        let value = read(contents.values.get(key)?);
        if let Ok(read) = serde_json::to_value(&value) {
            contents.read.insert(key.to_string(), read);
        }
        Some(value)
    }

    /// Stores `value` under `key`, as the changes since it was read, removes the values of
    /// `removed`, and writes the file. The values hold for the session even when the file cannot
    /// be written.
    fn write(&self, key: &str, value: &impl Serialize, removed: &[&str]) -> anyhow::Result<()> {
        let written = serde_json::to_value(value)?;
        let mut contents = lock(&self.contents);
        let stored = contents.values.remove(key);
        let stored = with_changes(stored, contents.read.get(key), &written);
        contents.values.insert(key.to_string(), stored);
        contents.read.insert(key.to_string(), written);
        for key in removed {
            contents.values.remove(*key);
            contents.read.remove(*key);
        }
        anyhow::ensure!(
            contents.writable,
            "{} could not be read: not written over",
            self.path.display()
        );
        write_whole(&self.path, &serde_json::to_vec_pretty(&contents.values)?)
    }

    /// The stored projects, or the last repository of an older version as the only one.
    fn projects(&self) -> ProjectList {
        if let Some(list) = self.read(PROJECTS_KEY, |stored| {
            read_lenient::<ProjectList>(stored).normalized()
        }) {
            return list;
        }
        let last = self.get(LAST_REPOSITORY_KEY);
        let Some(root) = last.as_ref().and_then(|root| root.as_str()) else {
            return ProjectList::default();
        };
        let project = Project::stored_before_ids(
            repository_name(root),
            Location::Local {
                root: root.to_string(),
            },
        );
        let list = ProjectList {
            active: Some(project.id.clone()),
            projects: vec![project],
            ..ProjectList::default()
        };
        if let Err(error) = self.write_projects(&list) {
            tracing::warn!(error = %format!("{error:#}"), "could not store the projects");
        }
        list
    }

    fn write_projects(&self, list: &ProjectList) -> anyhow::Result<()> {
        self.write(PROJECTS_KEY, list, &[LAST_REPOSITORY_KEY])
    }

    /// The stored settings, each one never stored or unreadable its default.
    fn settings(&self) -> Settings {
        self.read(SETTINGS_KEY, read_lenient::<Settings>)
            .unwrap_or_default()
    }
}

impl Contents {
    fn new(values: Map<String, Value>, writable: bool) -> Self {
        Self {
            values,
            read: Map::new(),
            writable,
        }
    }
}

/// Moves a file whose text does not read aside; whether the place is free to be written.
fn set_aside(path: &Path, error: &serde_json::Error) -> bool {
    let aside = path.with_file_name(UNREADABLE_FILE);
    match fs::rename(path, &aside) {
        Ok(()) => {
            tracing::warn!(
                %error,
                aside = %aside.display(),
                "the settings could not be read: set aside, the defaults in use"
            );
            true
        }
        Err(moved) => {
            tracing::error!(
                %error,
                %moved,
                path = %path.display(),
                "the settings could not be read nor set aside: not written this session"
            );
            false
        }
    }
}

pub(crate) fn load_projects(app: &tauri::AppHandle) -> ProjectList {
    app.state::<SettingsFile>().projects()
}

pub(crate) fn save_projects(app: &tauri::AppHandle, list: &ProjectList) -> anyhow::Result<()> {
    app.state::<SettingsFile>().write_projects(list)
}

pub(crate) fn load_settings(app: &tauri::AppHandle) -> Settings {
    app.state::<SettingsFile>().settings()
}

pub(crate) fn save_settings(app: &tauri::AppHandle, settings: &Settings) -> anyhow::Result<()> {
    app.state::<SettingsFile>()
        .write(SETTINGS_KEY, settings, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_written_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(SettingsFile::open(dir.path()).get(SETTINGS_KEY), None);
        let file = SettingsFile::open(dir.path());
        file.write(LAST_REPOSITORY_KEY, &"/dev/shop", &[]).unwrap();
        file.write(SETTINGS_KEY, &serde_json::json!({ "theme": "light" }), &[])
            .unwrap();
        file.write(PROJECTS_KEY, &serde_json::json!([]), &[LAST_REPOSITORY_KEY])
            .unwrap();
        let again = SettingsFile::open(dir.path());
        assert_eq!(
            again.get(SETTINGS_KEY),
            Some(serde_json::json!({ "theme": "light" }))
        );
        assert_eq!(again.get(PROJECTS_KEY), Some(serde_json::json!([])));
        assert_eq!(again.get(LAST_REPOSITORY_KEY), None);
    }

    /// The form the store plugin wrote, read as it was.
    #[test]
    fn the_file_of_earlier_versions_is_read() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(STORE_FILE),
            "{\n  \"settings\": { \"theme\": \"light\" },\n  \"lastRepository\": \"/dev/shop\"\n}",
        )
        .unwrap();
        let file = SettingsFile::open(dir.path());
        assert_eq!(
            file.get(LAST_REPOSITORY_KEY),
            Some(Value::from("/dev/shop"))
        );
        assert_eq!(
            file.get(SETTINGS_KEY),
            Some(serde_json::json!({ "theme": "light" }))
        );
    }

    #[test]
    fn an_unreadable_file_is_set_aside_not_written_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STORE_FILE);
        fs::write(&path, "{ \"projects\": [ { \"id\"").unwrap();
        let file = SettingsFile::open(dir.path());
        assert_eq!(file.get(PROJECTS_KEY), None);
        assert_eq!(
            fs::read_to_string(dir.path().join(UNREADABLE_FILE)).unwrap(),
            "{ \"projects\": [ { \"id\""
        );
        file.write(SETTINGS_KEY, &serde_json::json!({}), &[])
            .unwrap();
        assert_eq!(
            SettingsFile::open(dir.path()).get(SETTINGS_KEY),
            Some(serde_json::json!({}))
        );
    }

    #[test]
    fn a_file_the_disk_does_not_give_stays_and_is_never_written() {
        let dir = tempfile::tempdir().unwrap();
        // a folder where the file is: opening or reading it fails on every system
        let path = dir.path().join(STORE_FILE);
        fs::create_dir(&path).unwrap();
        let file = SettingsFile::open(dir.path());
        assert!(file
            .write(SETTINGS_KEY, &serde_json::json!({}), &[])
            .is_err());
        assert!(path.is_dir());
        assert!(!dir.path().join(UNREADABLE_FILE).exists());
    }

    #[test]
    fn a_file_that_cannot_be_set_aside_is_never_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STORE_FILE);
        fs::write(&path, "not json").unwrap();
        // the place to set it aside is taken by a folder that is not empty
        fs::create_dir(dir.path().join(UNREADABLE_FILE)).unwrap();
        fs::write(dir.path().join(UNREADABLE_FILE).join("x"), "").unwrap();
        let file = SettingsFile::open(dir.path());
        assert!(file
            .write(SETTINGS_KEY, &serde_json::json!({}), &[])
            .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not json");
    }

    fn stored(dir: &Path) -> Value {
        serde_json::from_slice(&fs::read(dir.join(STORE_FILE)).unwrap()).unwrap()
    }

    /// A value another version wrote, or a typo: its default in use, stored as it is until the
    /// user changes it; the settings beside it read.
    #[test]
    fn a_setting_that_does_not_read_stays_stored_until_changed() {
        use sidekyk_core::modules::settings::{Language, Theme};
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(STORE_FILE),
            r#"{ "settings": { "theme": "purple", "language": "it", "fontSize": 14 } }"#,
        )
        .unwrap();
        let file = SettingsFile::open(dir.path());
        let mut settings = file.settings();
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.language, Some(Language::It));

        settings.language = Some(Language::En);
        file.write(SETTINGS_KEY, &settings, &[]).unwrap();
        let written = stored(dir.path());
        assert_eq!(written["settings"]["theme"], "purple");
        assert_eq!(written["settings"]["fontSize"], 14);
        assert_eq!(written["settings"]["language"], "en");

        settings.theme = Theme::Light;
        file.write(SETTINGS_KEY, &settings, &[]).unwrap();
        assert_eq!(stored(dir.path())["settings"]["theme"], "light");
        assert_eq!(SettingsFile::open(dir.path()).settings(), settings);
    }

    /// A project of a newer version (a kind of folder this one does not know) is not shown, and
    /// stays stored, with its layout; a project read keeps the values this version does not know.
    #[test]
    fn a_project_that_does_not_read_stays_stored() {
        let dir = tempfile::tempdir().unwrap();
        let newer = serde_json::json!({
            "id": "ffffffffffffffff",
            "name": "far",
            "folders": [{ "id": "eeeeeeeeeeeeeeee", "kind": "ssh", "host": "box", "root": "/far" }]
        });
        let layout = serde_json::json!({ "minimized": [], "split": 0.3 });
        fs::write(
            dir.path().join(STORE_FILE),
            serde_json::to_vec(&serde_json::json!({ "projects": {
                "projects": [
                    newer,
                    {
                        "id": "0123456789abcdef",
                        "name": "shop",
                        "pinned": true,
                        "folders": [{ "id": "0123456789abcdef", "kind": "local", "root": "/shop" }]
                    }
                ],
                "active": "ffffffffffffffff",
                "layouts": { "ffffffffffffffff": layout }
            }}))
            .unwrap(),
        )
        .unwrap();
        let file = SettingsFile::open(dir.path());
        let mut list = file.projects();
        assert_eq!(list.projects.len(), 1);
        assert_eq!(list.active.as_deref(), Some("0123456789abcdef"));

        list.projects[0].name = "store".into();
        list.projects.push(Project::new(
            "docs".into(),
            [Location::Local {
                root: "/docs".into(),
            }],
        ));
        file.write_projects(&list).unwrap();
        let written = &stored(dir.path())["projects"];
        let projects = written["projects"].as_array().unwrap();
        assert_eq!(projects.len(), 3);
        assert_eq!(projects[0], newer);
        assert_eq!(projects[1]["name"], "store");
        assert_eq!(projects[1]["pinned"], true);
        assert_eq!(projects[2]["name"], "docs");
        // the project on screen was another version's: it stays so for that version
        assert_eq!(written["active"], "ffffffffffffffff");
        assert_eq!(written["layouts"]["ffffffffffffffff"], layout);
        assert_eq!(SettingsFile::open(dir.path()).projects(), list);
    }
}
