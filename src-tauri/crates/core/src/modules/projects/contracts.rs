//! Wire contracts shared with the frontend (`src/modules/projects/model/project.types.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::avatar::{Avatar, AvatarColor};
use super::stored::readable_projects;
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

/// A project: a name, its avatar, its notes, and the folders it follows
/// (`docs/features/projects.md`). Read from storage by `readable_projects`, every older form too.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// What the frontend and the app data (notes, layouts) know the project by. Made once and
    /// kept: a project whose folder moves keeps its id.
    pub id: String,
    pub name: String,
    /// The folders it follows, in the order they were added: none, one, or several on one
    /// machine, none inside another.
    pub folders: Vec<ProjectFolder>,
    pub avatar: Avatar,
}

impl Project {
    /// A new project, with a new id, following `folders`, each with a new id; its avatar of
    /// `color`, its letters from the name.
    pub fn new(
        name: String,
        folders: impl IntoIterator<Item = Location>,
        color: AvatarColor,
    ) -> Self {
        Self {
            id: new_id(),
            name,
            folders: folders.into_iter().map(ProjectFolder::new).collect(),
            avatar: Avatar::of_color(color),
        }
    }

    /// A project as stored before ids were made: its id is its location's, and its folder's too.
    pub fn stored_before_ids(name: String, location: Location, color: AvatarColor) -> Self {
        let id = location.id_before_made_ids();
        Self {
            folders: vec![ProjectFolder {
                id: id.clone(),
                location,
            }],
            id,
            name,
            avatar: Avatar::of_color(color),
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
pub(super) mod tests {
    use super::*;

    pub(crate) fn local(root: &str) -> Location {
        Location::Local { root: root.into() }
    }

    pub(crate) fn wsl(distro: &str, root: &str) -> Location {
        Location::Wsl {
            distro: distro.into(),
            root: root.into(),
        }
    }

    pub(crate) fn folder(id: &str, location: Location) -> ProjectFolder {
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
                    avatar: Avatar::of_color(AvatarColor::FIRST),
                },
                Project {
                    id: "fedcba9876543210".into(),
                    name: "shop".into(),
                    folders: vec![
                        folder("aaaaaaaaaaaaaaaa", wsl("Ubuntu", "/home/ale/shop/api")),
                        folder("bbbbbbbbbbbbbbbb", wsl("Ubuntu", "/home/ale/shop/web")),
                    ],
                    avatar: Avatar {
                        color: AvatarColor::try_from(10).unwrap(),
                        letters: Some("SW".into()),
                    },
                },
                Project {
                    id: "00112233445566ff".into(),
                    name: "Home".into(),
                    folders: vec![],
                    avatar: Avatar::of_color(AvatarColor::try_from(2).unwrap()),
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
                    "folders": [{ "id": "0123456789abcdef", "kind": "local", "root": "/r" }],
                    "avatar": { "color": 1, "letters": null }
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
                    ],
                    "avatar": { "color": 10, "letters": "SW" }
                },
                {
                    "id": "00112233445566ff",
                    "name": "Home",
                    "folders": [],
                    "avatar": { "color": 2, "letters": null }
                }
            ],
            "active": "0123456789abcdef",
            "layouts": { "0123456789abcdef": { "minimized": ["files"], "split": 0.4 } }
        });
        assert_eq!(serde_json::to_value(&list).unwrap(), json);
        assert_eq!(serde_json::from_value::<ProjectList>(json).unwrap(), list);
    }

    #[test]
    fn a_new_project_gets_an_id_of_its_own() {
        let a = Project::new("shop".into(), [local("/shop")], AvatarColor::FIRST);
        let b = Project::new("shop".into(), [local("/shop")], AvatarColor::FIRST);
        assert_ne!(a.id, b.id);
        assert_ne!(a.folders[0].id, b.folders[0].id);
        assert_ne!(a.folders[0].id, a.id);
        assert_eq!(a.folders[0].repository(&a).root, "/shop");
        let home = Project::new("Home".into(), [], AvatarColor::FIRST);
        assert!(home.folders.is_empty());
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
