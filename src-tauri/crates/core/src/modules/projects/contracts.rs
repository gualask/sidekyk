//! Wire contracts shared with the frontend (`src/modules/projects/model/project.types.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::modules::folder::RepositoryInfo;
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

/// A project: a name, its notes, and the folders it follows (`docs/features/projects.md`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "StoredProject")]
pub struct Project {
    /// What the frontend and the app data (notes, layouts) know the project by. Made once and
    /// kept: a project whose folder moves keeps its id.
    pub id: String,
    pub name: String,
    /// The folders it follows, in the order they were added: none, one, or several on one
    /// machine, none inside another.
    pub folders: Vec<ProjectFolder>,
}

impl Project {
    /// A new project, with a new id, following `folders`, each with a new id.
    pub fn new(name: String, folders: impl IntoIterator<Item = Location>) -> Self {
        Self {
            id: new_id(),
            name,
            folders: folders.into_iter().map(ProjectFolder::new).collect(),
        }
    }

    /// A project as stored before ids were made: its id is its location's, and its folder's too.
    pub fn stored_before_ids(name: String, location: Location) -> Self {
        let id = location.id_before_made_ids();
        Self {
            folders: vec![ProjectFolder {
                id: id.clone(),
                location,
            }],
            id,
            name,
        }
    }

    /// Its folder of this id.
    pub fn folder(&self, id: &str) -> Option<&ProjectFolder> {
        self.folders.iter().find(|f| f.id == id)
    }

    /// Where its folders are, in their order.
    pub fn locations(&self) -> impl Iterator<Item = &Location> {
        self.folders.iter().map(|f| &f.location)
    }
}

/// A folder a project follows: where it is, and an id of its own, which the frontend asks what
/// reads it by (`docs/features/projects.md`). Made once and kept: a folder that moves keeps it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolder {
    pub id: String,
    #[serde(flatten)]
    pub location: Location,
}

impl ProjectFolder {
    pub fn new(location: Location) -> Self {
        Self {
            id: new_id(),
            location,
        }
    }

    /// The repository as the machine holding it knows it, named after `project`.
    pub fn repository(&self, project: &Project) -> RepositoryInfo {
        RepositoryInfo {
            root: self.location.root().to_string(),
            name: project.name.clone(),
        }
    }
}

/// Where a project's folder is (`docs/features/wsl.md`).
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

/// What a folder picked for a project did (Locate…, Add folder…): the project follows it, or that
/// folder is another project's, which stays as it is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FolderChange {
    Changed {
        list: ProjectList,
    },
    #[serde(rename_all = "camelCase")]
    InProject {
        id: String,
        name: String,
    },
}

/// A folder picked for a new project: one no project has yet (`path` as picked, to give back on
/// creating it; `name` its folder's), with the repositories right inside it when it is a folder
/// without git (a parent of api and web); or another project's.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FolderChoice {
    #[serde(rename_all = "camelCase")]
    Usable {
        path: String,
        name: String,
        location: Location,
        repositories: Vec<FolderInside>,
    },
    #[serde(rename_all = "camelCase")]
    InProject { id: String, name: String },
}

impl FolderChoice {
    /// Whether it is a folder without git with repositories right inside it that no project has
    /// yet: the user says what it becomes (one project with them, a project each, itself).
    pub fn holds_free_repositories(&self) -> bool {
        match self {
            Self::Usable { repositories, .. } => {
                repositories.iter().any(|r| r.in_project.is_none())
            }
            Self::InProject { .. } => false,
        }
    }
}

/// What a folder given on the command line did, for the frontend to take once: a project put on
/// screen with the folder to show, or a folder above repositories to ask about in the New project
/// dialog.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Opened {
    #[serde(rename_all = "camelCase")]
    Project {
        id: String,
        folder_id: String,
    },
    Choice {
        choice: FolderChoice,
    },
}

/// A repository right inside a folder picked: its path, as the picked one is written, to give
/// back on creating a project; its name and place; the name of the project that has it already,
/// if any.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInside {
    pub path: String,
    pub name: String,
    pub location: Location,
    pub in_project: Option<String>,
}

/// A project as stored: today `{ id, name, folders }`, each folder with its id. Older forms are
/// read too: folders without ids (one at most), one location with its id, one location without
/// (before ids), or a root (before locations), the last two taking their location's id. A folder
/// stored without id was its project's only one, and takes the project's.
#[derive(Deserialize)]
struct StoredProject {
    id: Option<String>,
    name: String,
    folders: Option<Vec<StoredFolder>>,
    location: Option<Location>,
    root: Option<String>,
}

#[derive(Deserialize)]
struct StoredFolder {
    id: Option<String>,
    #[serde(flatten)]
    location: Location,
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
                let folder = StoredFolder { id: None, location };
                (vec![folder], id)
            }
            (None, None) => return Err("a project with no folders"),
        };
        if folders.len() > 1 && folders.iter().any(|f| f.id.is_none()) {
            return Err("a folder with no id beside another");
        }
        if folders.iter().any(|f| f.id.as_deref() == Some("")) {
            return Err("a folder with an empty id");
        }
        let folders = folders
            .into_iter()
            .map(|folder| ProjectFolder {
                id: folder.id.unwrap_or_else(|| id.clone()),
                location: folder.location,
            })
            .collect();
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

    fn folder(id: &str, location: Location) -> ProjectFolder {
        ProjectFolder {
            id: id.into(),
            location,
        }
    }

    #[test]
    fn project_list_serializes_with_the_frontend_field_names() {
        let list = ProjectList {
            projects: vec![
                Project {
                    id: "0123456789abcdef".into(),
                    name: "r".into(),
                    folders: vec![folder("0123456789abcdef", local("/r"))],
                },
                Project {
                    id: "fedcba9876543210".into(),
                    name: "shop".into(),
                    folders: vec![
                        folder("aaaaaaaaaaaaaaaa", wsl("Ubuntu", "/home/ale/shop/api")),
                        folder("bbbbbbbbbbbbbbbb", wsl("Ubuntu", "/home/ale/shop/web")),
                    ],
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
                    "folders": [{ "id": "0123456789abcdef", "kind": "local", "root": "/r" }]
                },
                {
                    "id": "fedcba9876543210",
                    "name": "shop",
                    "folders": [
                        {
                            "id": "aaaaaaaaaaaaaaaa",
                            "kind": "wsl",
                            "distro": "Ubuntu",
                            "root": "/home/ale/shop/api"
                        },
                        {
                            "id": "bbbbbbbbbbbbbbbb",
                            "kind": "wsl",
                            "distro": "Ubuntu",
                            "root": "/home/ale/shop/web"
                        }
                    ]
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
        assert_eq!(
            project.folders,
            [folder(
                "wsl:Ubuntu:/home/ale/shop",
                wsl("Ubuntu", "/home/ale/shop")
            )]
        );
    }

    #[test]
    fn a_folder_stored_without_id_takes_its_project_s() {
        let json = serde_json::json!({
            "id": "0123456789abcdef",
            "name": "r",
            "folders": [{ "kind": "local", "root": "/r" }]
        });
        let project = serde_json::from_value::<Project>(json).unwrap();
        assert_eq!(project.folders, [folder("0123456789abcdef", local("/r"))]);
        let two = serde_json::json!({
            "id": "0123456789abcdef",
            "name": "r",
            "folders": [{ "kind": "local", "root": "/r" }, { "id": "x", "kind": "local", "root": "/s" }]
        });
        assert!(serde_json::from_value::<Project>(two).is_err());
        let empty = serde_json::json!({
            "id": "0123456789abcdef",
            "name": "r",
            "folders": [{ "id": "", "kind": "local", "root": "/r" }]
        });
        assert!(serde_json::from_value::<Project>(empty).is_err());
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
        let a = Project::new("shop".into(), [local("/shop")]);
        let b = Project::new("shop".into(), [local("/shop")]);
        assert_ne!(a.id, b.id);
        assert_ne!(a.folders[0].id, b.folders[0].id);
        assert_ne!(a.folders[0].id, a.id);
        assert_eq!(a.folders[0].repository(&a).root, "/shop");
        assert!(Project::new("Home".into(), []).folders.is_empty());
    }

    #[test]
    fn a_folder_change_tells_the_frontend_what_happened() {
        let in_project = FolderChange::InProject {
            id: "0123456789abcdef".into(),
            name: "shop".into(),
        };
        assert_eq!(
            serde_json::to_value(in_project).unwrap(),
            serde_json::json!({ "kind": "inProject", "id": "0123456789abcdef", "name": "shop" })
        );
        let changed = FolderChange::Changed {
            list: ProjectList::default(),
        };
        assert_eq!(serde_json::to_value(changed).unwrap()["kind"], "changed");
    }

    #[test]
    fn a_folder_choice_tells_the_dialog_what_was_picked() {
        let usable = FolderChoice::Usable {
            path: "/Users/ale/Dev/api/src".into(),
            name: "api".into(),
            location: Location::Local {
                root: "/Users/ale/Dev/api".into(),
            },
            repositories: vec![FolderInside {
                path: "/Users/ale/Dev/api/src/web".into(),
                name: "web".into(),
                location: local("/Users/ale/Dev/api/web"),
                in_project: Some("Shop".into()),
            }],
        };
        assert_eq!(
            serde_json::to_value(usable).unwrap(),
            serde_json::json!({
                "kind": "usable",
                "path": "/Users/ale/Dev/api/src",
                "name": "api",
                "location": { "kind": "local", "root": "/Users/ale/Dev/api" },
                "repositories": [
                    {
                        "path": "/Users/ale/Dev/api/src/web",
                        "name": "web",
                        "location": { "kind": "local", "root": "/Users/ale/Dev/api/web" },
                        "inProject": "Shop"
                    }
                ]
            })
        );
        let in_project = FolderChoice::InProject {
            id: "0123456789abcdef".into(),
            name: "shop".into(),
        };
        assert_eq!(
            serde_json::to_value(in_project).unwrap()["kind"],
            "inProject"
        );
    }

    #[test]
    fn a_folder_opened_tells_the_frontend_what_to_show() {
        let project = Opened::Project {
            id: "0123456789abcdef".into(),
            folder_id: "aaaaaaaaaaaaaaaa".into(),
        };
        assert_eq!(
            serde_json::to_value(project).unwrap(),
            serde_json::json!({
                "kind": "project",
                "id": "0123456789abcdef",
                "folderId": "aaaaaaaaaaaaaaaa"
            })
        );
        let inside = |in_project: Option<&str>| FolderChoice::Usable {
            path: "/dev/shop".into(),
            name: "shop".into(),
            location: local("/dev/shop"),
            repositories: vec![FolderInside {
                path: "/dev/shop/api".into(),
                name: "api".into(),
                location: local("/dev/shop/api"),
                in_project: in_project.map(String::from),
            }],
        };
        assert!(inside(None).holds_free_repositories());
        assert!(!inside(Some("Shop")).holds_free_repositories());
        let choice = Opened::Choice {
            choice: inside(None),
        };
        assert_eq!(
            serde_json::to_value(choice).unwrap()["choice"]["kind"],
            "usable"
        );
    }

    #[test]
    fn a_list_stored_before_layouts_reads_without_them() {
        let json = serde_json::json!({ "projects": [], "active": null });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert!(list.layouts.is_empty());
    }

    #[test]
    fn a_list_stored_with_the_folders_shown_reads_without_them() {
        // the folder on screen was stored from 2026-11-02 to 2026-11-03; it is the window's now
        let json = serde_json::json!({
            "projects": [],
            "active": null,
            "shown": { "fedcba9876543210": "bbbbbbbbbbbbbbbb" }
        });
        assert!(serde_json::from_value::<ProjectList>(json).is_ok());
    }

    #[test]
    fn projects_changed_event_is_versioned() {
        assert_eq!(
            serde_json::to_value(ProjectsChangedEvent::default()).unwrap(),
            serde_json::json!({ "version": 1 })
        );
    }
}
