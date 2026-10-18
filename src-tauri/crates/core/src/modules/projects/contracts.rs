//! Wire contracts shared with the frontend (`src/modules/projects/model/project.types.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::modules::repository::RepositoryInfo;

pub const PROJECTS_CHANGED_EVENT: &str = "projects-changed";

/// Every project, and the one on screen. Also the form the list is stored in.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectList {
    /// In the order they were added.
    #[serde(deserialize_with = "readable_projects")]
    pub projects: Vec<Project>,
    /// The id of the project on screen: `None` only when there are no projects.
    pub active: Option<String>,
    /// How each project lays out its panels' tiles, by id; one never changed is not there. It
    /// goes with its project.
    #[serde(default)]
    pub layouts: BTreeMap<String, TilesLayout>,
}

/// A repository the user added.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "StoredProject")]
pub struct Project {
    /// What the frontend and the app data (notes, layouts) know the project by: `location.id()`.
    pub id: String,
    pub name: String,
    pub location: Location,
}

impl Project {
    pub fn new(name: String, location: Location) -> Self {
        Self {
            id: location.id(),
            name,
            location,
        }
    }

    /// A repository of this machine, as found there.
    pub fn local(found: RepositoryInfo) -> Self {
        Self::new(found.name, Location::Local { root: found.root })
    }

    /// The repository as the machine holding it knows it, for what reads it there.
    pub fn repository(&self) -> RepositoryInfo {
        RepositoryInfo {
            root: self.location.root().to_string(),
            name: self.name.clone(),
        }
    }
}

/// Where a project's repository is (`docs/plans/remote-projects.md`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Location {
    /// On this machine.
    Local { root: String },
    /// In a WSL distro, `root` a Linux path.
    Wsl { distro: String, root: String },
}

impl Location {
    /// The id of the project here: never read back, only compared. A local project's is its root,
    /// as before projects had ids; a WSL project's names its distro too, as VS Code's
    /// `vscode-remote://wsl+<distro>/<path>`. Two projects in one place have the same id.
    pub fn id(&self) -> String {
        match self {
            Self::Local { root } => root.clone(),
            Self::Wsl { distro, root } => format!("wsl:{distro}:{root}"),
        }
    }

    /// The repository's root on the machine that holds it.
    pub fn root(&self) -> &str {
        match self {
            Self::Local { root } | Self::Wsl { root, .. } => root,
        }
    }

    /// The root, for a repository of this machine.
    pub fn local_root(&self) -> Option<&str> {
        match self {
            Self::Local { root } => Some(root),
            Self::Wsl { .. } => None,
        }
    }
}

/// A project as stored: its id is not read but made again from its location, so the two always
/// agree; a project stored before locations has its root instead, and is a local one.
#[derive(Deserialize)]
struct StoredProject {
    name: String,
    location: Option<Location>,
    root: Option<String>,
}

impl TryFrom<StoredProject> for Project {
    type Error = &'static str;

    fn try_from(stored: StoredProject) -> Result<Self, Self::Error> {
        let location = match (stored.location, stored.root) {
            (Some(location), _) => location,
            (None, Some(root)) => Location::Local { root },
            (None, None) => return Err("a project with no location"),
        };
        Ok(Project::new(stored.name, location))
    }
}

/// The stored projects that can be read: one that cannot (a location of a newer version, a file
/// edited by hand) is left out, not every project with it.
fn readable_projects<'de, D: Deserializer<'de>>(stored: D) -> Result<Vec<Project>, D::Error> {
    let stored = Vec::<serde_json::Value>::deserialize(stored)?;
    Ok(stored
        .into_iter()
        .filter_map(|project| {
            serde_json::from_value(project)
                .inspect_err(|error| tracing::warn!(%error, "a stored project cannot be read"))
                .ok()
        })
        .collect())
}

/// A project's tiles, as the user left them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TilesLayout {
    /// The panels minimized to the top bar, by id.
    pub minimized: Vec<String>,
    /// The share of the side column the upper tile takes, between 0 and 1.
    pub split: f64,
}

/// Emitted when the list changed without the frontend asking, such as a folder given on the
/// command line while the app runs. The frontend reads the list again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsChangedEvent {
    pub version: u8,
}

impl Default for ProjectsChangedEvent {
    fn default() -> Self {
        Self { version: 1 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_list_serializes_with_the_frontend_field_names() {
        let list = ProjectList {
            projects: vec![
                Project::new("r".into(), Location::Local { root: "/r".into() }),
                Project::new(
                    "shop".into(),
                    Location::Wsl {
                        distro: "Ubuntu".into(),
                        root: "/home/ale/shop".into(),
                    },
                ),
            ],
            active: Some("/r".into()),
            layouts: BTreeMap::from([(
                "/r".into(),
                TilesLayout {
                    minimized: vec!["files".into()],
                    split: 0.4,
                },
            )]),
        };
        let json = serde_json::json!({
            "projects": [
                { "id": "/r", "name": "r", "location": { "kind": "local", "root": "/r" } },
                {
                    "id": "wsl:Ubuntu:/home/ale/shop",
                    "name": "shop",
                    "location": { "kind": "wsl", "distro": "Ubuntu", "root": "/home/ale/shop" }
                }
            ],
            "active": "/r",
            "layouts": { "/r": { "minimized": ["files"], "split": 0.4 } }
        });
        assert_eq!(serde_json::to_value(&list).unwrap(), json);
        assert_eq!(serde_json::from_value::<ProjectList>(json).unwrap(), list);
    }

    #[test]
    fn a_project_stored_before_locations_is_a_local_one_with_its_root_as_id() {
        let json =
            serde_json::json!({ "projects": [{ "root": "/r", "name": "r" }], "active": "/r" });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert_eq!(
            list.projects,
            [Project::new(
                "r".into(),
                Location::Local { root: "/r".into() }
            )]
        );
        assert_eq!(list.projects[0].id, "/r");
    }

    #[test]
    fn a_stored_project_that_cannot_be_read_leaves_the_others() {
        let json = serde_json::json!({
            "projects": [
                { "name": "r", "location": { "kind": "local", "root": "/r" } },
                { "name": "s", "location": { "kind": "ssh", "host": "box" } },
                { "name": "t" }
            ],
            "active": "/r"
        });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert_eq!(
            list.projects,
            [Project::new(
                "r".into(),
                Location::Local { root: "/r".into() }
            )]
        );
    }

    #[test]
    fn a_stored_id_gives_way_to_the_location() {
        let json = serde_json::json!({
            "id": "edited", "name": "r", "location": { "kind": "local", "root": "/r" }
        });
        assert_eq!(serde_json::from_value::<Project>(json).unwrap().id, "/r");
    }

    #[test]
    fn a_list_stored_before_layouts_reads_without_them() {
        let json = serde_json::json!({ "projects": [], "active": null });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert!(list.layouts.is_empty());
    }

    #[test]
    fn projects_changed_event_is_versioned() {
        assert_eq!(
            serde_json::to_value(ProjectsChangedEvent::default()).unwrap(),
            serde_json::json!({ "version": 1 })
        );
    }
}
