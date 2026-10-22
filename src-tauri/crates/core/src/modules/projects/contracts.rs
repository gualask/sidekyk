//! Wire contracts shared with the frontend (`src/modules/projects/model/project.types.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::modules::repository::RepositoryInfo;
use crate::shared::id::new_id;

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

/// A project: a name, its notes, and the folders it follows (`docs/plans/project-folders.md`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "StoredProject")]
pub struct Project {
    /// What the frontend and the app data (notes, layouts) know the project by. Made once and
    /// kept: a project whose folder moves keeps its id.
    pub id: String,
    pub name: String,
    /// The folders it follows: none, or one repository.
    pub folders: Vec<Location>,
}

impl Project {
    /// A new project, with a new id: none or one folder for now.
    pub fn new(name: String, folder: Option<Location>) -> Self {
        Self {
            id: new_id(),
            name,
            folders: folder.into_iter().collect(),
        }
    }

    /// A project as stored before ids were made: its id is its location's.
    pub fn stored_before_ids(name: String, location: Location) -> Self {
        Self {
            id: location.id_before_made_ids(),
            name,
            folders: vec![location],
        }
    }

    /// The folder it follows, if any.
    pub fn folder(&self) -> Option<&Location> {
        self.folders.first()
    }

    /// Its repository: the folder, which says what reads it, and the repository as the machine
    /// holding it knows it. `None` for a project without folder.
    pub fn repository(&self) -> Option<(&Location, RepositoryInfo)> {
        let folder = self.folder()?;
        let info = RepositoryInfo {
            root: folder.root().to_string(),
            name: self.name.clone(),
        };
        Some((folder, info))
    }
}

/// Where a project's folder is (`docs/plans/remote-projects.md`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Location {
    /// On this machine.
    Local { root: String },
    /// In a WSL distro, `root` a Linux path.
    Wsl { distro: String, root: String },
}

impl Location {
    /// The id a project at this location had before ids were made, kept by those stored then: a
    /// local project's root; a WSL project's names its distro too, as VS Code's
    /// `vscode-remote://wsl+<distro>/<path>`.
    pub fn id_before_made_ids(&self) -> String {
        match self {
            Self::Local { root } => root.clone(),
            Self::Wsl { distro, root } => format!("wsl:{distro}:{root}"),
        }
    }

    /// The folder's root on the machine that holds it.
    pub fn root(&self) -> &str {
        match self {
            Self::Local { root } | Self::Wsl { root, .. } => root,
        }
    }

    /// The root, for a folder of this machine.
    pub fn local_root(&self) -> Option<&str> {
        match self {
            Self::Local { root } => Some(root),
            Self::Wsl { .. } => None,
        }
    }
}

/// What Locate… did: the project follows its folder's new place, or that folder is another
/// project's, which stays as it is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Relocation {
    Moved {
        list: ProjectList,
    },
    #[serde(rename_all = "camelCase")]
    InProject {
        id: String,
        name: String,
    },
}

/// A project as stored: today `{ id, name, folders }`. Older forms are read too: one location
/// with its id, one location without (before ids), or a root (before locations), the last two
/// taking their location's id.
#[derive(Deserialize)]
struct StoredProject {
    id: Option<String>,
    name: String,
    folders: Option<Vec<Location>>,
    location: Option<Location>,
    root: Option<String>,
}

impl TryFrom<StoredProject> for Project {
    type Error = &'static str;

    fn try_from(stored: StoredProject) -> Result<Self, Self::Error> {
        if stored.id.as_deref() == Some("") {
            return Err("a project with an empty id");
        }
        let older = stored
            .location
            .or(stored.root.map(|root| Location::Local { root }));
        let (folders, id) = match (stored.folders, older) {
            (Some(folders), _) => (folders, stored.id.ok_or("a project with no id")?),
            (None, Some(location)) => {
                let id = stored.id.unwrap_or_else(|| location.id_before_made_ids());
                (vec![location], id)
            }
            (None, None) => return Err("a project with no folders"),
        };
        Ok(Project {
            id,
            name: stored.name,
            folders,
        })
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

    fn local(root: &str) -> Location {
        Location::Local { root: root.into() }
    }

    fn wsl(distro: &str, root: &str) -> Location {
        Location::Wsl {
            distro: distro.into(),
            root: root.into(),
        }
    }

    #[test]
    fn project_list_serializes_with_the_frontend_field_names() {
        let list = ProjectList {
            projects: vec![
                Project {
                    id: "0123456789abcdef".into(),
                    name: "r".into(),
                    folders: vec![local("/r")],
                },
                Project {
                    id: "fedcba9876543210".into(),
                    name: "shop".into(),
                    folders: vec![wsl("Ubuntu", "/home/ale/shop")],
                },
                Project {
                    id: "00112233445566ff".into(),
                    name: "Home".into(),
                    folders: vec![],
                },
            ],
            active: Some("0123456789abcdef".into()),
            layouts: BTreeMap::from([(
                "0123456789abcdef".into(),
                TilesLayout {
                    minimized: vec!["files".into()],
                    split: 0.4,
                },
            )]),
        };
        let json = serde_json::json!({
            "projects": [
                {
                    "id": "0123456789abcdef",
                    "name": "r",
                    "folders": [{ "kind": "local", "root": "/r" }]
                },
                {
                    "id": "fedcba9876543210",
                    "name": "shop",
                    "folders": [{ "kind": "wsl", "distro": "Ubuntu", "root": "/home/ale/shop" }]
                },
                { "id": "00112233445566ff", "name": "Home", "folders": [] }
            ],
            "active": "0123456789abcdef",
            "layouts": { "0123456789abcdef": { "minimized": ["files"], "split": 0.4 } }
        });
        assert_eq!(serde_json::to_value(&list).unwrap(), json);
        assert_eq!(serde_json::from_value::<ProjectList>(json).unwrap(), list);
    }

    #[test]
    fn a_project_stored_with_a_location_keeps_its_id() {
        let json = serde_json::json!({
            "id": "wsl:Ubuntu:/home/ale/shop",
            "name": "shop",
            "location": { "kind": "wsl", "distro": "Ubuntu", "root": "/home/ale/shop" }
        });
        let project = serde_json::from_value::<Project>(json).unwrap();
        assert_eq!(project.id, "wsl:Ubuntu:/home/ale/shop");
        assert_eq!(project.folders, [wsl("Ubuntu", "/home/ale/shop")]);
    }

    #[test]
    fn a_project_stored_before_ids_takes_its_location_s() {
        let json = serde_json::json!({
            "name": "shop", "location": { "kind": "wsl", "distro": "Ubuntu", "root": "/s" }
        });
        let project = serde_json::from_value::<Project>(json).unwrap();
        assert_eq!(project.id, "wsl:Ubuntu:/s");
        assert_eq!(
            project,
            Project::stored_before_ids("shop".into(), wsl("Ubuntu", "/s"))
        );
    }

    #[test]
    fn a_project_stored_before_locations_is_a_local_one_with_its_root_as_id() {
        let json =
            serde_json::json!({ "projects": [{ "root": "/r", "name": "r" }], "active": "/r" });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert_eq!(
            list.projects,
            [Project::stored_before_ids("r".into(), local("/r"))]
        );
        assert_eq!(list.projects[0].id, "/r");
    }

    #[test]
    fn a_stored_project_that_cannot_be_read_leaves_the_others() {
        let json = serde_json::json!({
            "projects": [
                { "name": "r", "location": { "kind": "local", "root": "/r" } },
                { "name": "s", "location": { "kind": "ssh", "host": "box" } },
                { "name": "t" },
                { "name": "u", "folders": [] },
                { "id": "", "name": "v", "folders": [] }
            ],
            "active": "/r"
        });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert_eq!(
            list.projects,
            [Project::stored_before_ids("r".into(), local("/r"))]
        );
    }

    #[test]
    fn a_new_project_gets_an_id_of_its_own() {
        let a = Project::new("shop".into(), Some(local("/shop")));
        let b = Project::new("shop".into(), Some(local("/shop")));
        assert_ne!(a.id, b.id);
        assert_eq!(a.repository().unwrap().1.root, "/shop");
        assert_eq!(Project::new("Home".into(), None).repository(), None);
    }

    #[test]
    fn a_relocation_tells_the_frontend_what_happened() {
        let in_project = Relocation::InProject {
            id: "0123456789abcdef".into(),
            name: "shop".into(),
        };
        assert_eq!(
            serde_json::to_value(in_project).unwrap(),
            serde_json::json!({ "kind": "inProject", "id": "0123456789abcdef", "name": "shop" })
        );
        let moved = Relocation::Moved {
            list: ProjectList::default(),
        };
        assert_eq!(serde_json::to_value(moved).unwrap()["kind"], "moved");
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
