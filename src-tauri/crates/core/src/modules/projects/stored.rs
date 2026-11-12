//! The stored forms of a project, read whole or left out: today's, and the older ones it was
//! stored in before.

use std::collections::HashSet;

use serde::{Deserialize, Deserializer};

use super::avatar::{valid_letters, Avatar, AvatarColor};
use super::contracts::{Location, Project, ProjectFolder};

/// A project as stored: today `{ id, name, folders, avatar }`, each folder with its id. Older
/// forms are read too: no avatar, folders without ids (one at most), one location with its id,
/// one location without (before ids), or a root (before locations), the last two taking their
/// location's id. A folder stored without id was its project's only one, and takes the project's.
#[derive(Deserialize)]
pub(super) struct StoredProject {
    id: Option<String>,
    name: String,
    folders: Option<Vec<StoredFolder>>,
    location: Option<Location>,
    root: Option<String>,
    #[serde(default)]
    avatar: StoredAvatar,
}

#[derive(Deserialize)]
struct StoredFolder {
    id: Option<String>,
    #[serde(flatten)]
    location: Location,
}

/// An avatar as stored: none before avatars. A color or letters that cannot be shown (a file
/// edited by hand) count as none, the project kept.
#[derive(Default, Deserialize)]
struct StoredAvatar {
    color: Option<u8>,
    letters: Option<String>,
}

/// A stored project read whole but for the color it may lack, which the list gives it
/// (`readable_projects`).
struct ReadProject {
    id: String,
    name: String,
    folders: Vec<ProjectFolder>,
    color: Option<AvatarColor>,
    letters: Option<String>,
}

impl ReadProject {
    /// The project, its avatar of `color`.
    fn with_color(self, color: AvatarColor) -> Project {
        Project {
            id: self.id,
            name: self.name,
            folders: self.folders,
            avatar: Avatar {
                color,
                letters: self.letters,
            },
        }
    }
}

impl TryFrom<StoredProject> for ReadProject {
    type Error = &'static str;

    fn try_from(stored: StoredProject) -> Result<Self, Self::Error> {
        if stored.id.as_deref() == Some("") {
            return Err("a project with an empty id");
        }
        let older = stored
            .location
            .or(stored.root.map(|root| Location::Local { root }));
        let (folders, id) = stored_folders(stored.folders, older, stored.id)?;
        checked_folders(&folders)?;
        let folders = folders
            .into_iter()
            .map(|folder| ProjectFolder {
                id: folder.id.unwrap_or_else(|| id.clone()),
                location: folder.location,
            })
            .collect();
        let color = stored
            .avatar
            .color
            .and_then(|number| AvatarColor::try_from(number).ok());
        Ok(Self {
            id,
            name: stored.name,
            folders,
            color,
            letters: stored.avatar.letters.filter(|l| valid_letters(l)),
        })
    }
}

/// A stored project's folders and id: today's folders with their project's id, or its one older
/// location, whose id the project takes when it stored none.
fn stored_folders(
    folders: Option<Vec<StoredFolder>>,
    older: Option<Location>,
    id: Option<String>,
) -> Result<(Vec<StoredFolder>, String), &'static str> {
    match (folders, older) {
        (Some(folders), _) => Ok((folders, id.ok_or("a project with no id")?)),
        (None, Some(location)) => {
            let id = id.unwrap_or_else(|| location.id_before_made_ids());
            let folder = StoredFolder { id: None, location };
            Ok((vec![folder], id))
        }
        (None, None) => Err("a project with no folders"),
    }
}

/// Refuses folders stored without an id beside another, or with an empty one.
fn checked_folders(folders: &[StoredFolder]) -> Result<(), &'static str> {
    if folders.len() > 1 && folders.iter().any(|f| f.id.is_none()) {
        return Err("a folder with no id beside another");
    }
    if folders.iter().any(|f| f.id.as_deref() == Some("")) {
        return Err("a folder with an empty id");
    }
    Ok(())
}

/// The stored projects that can be read: one that cannot (a location of a newer version, a file
/// edited by hand) is left out, not every project with it. One stored without a color takes the
/// least used, in the list's order, as a new project does: the same stored list always gives the
/// same colors, which the store keeps from the list's next change (`leave_out_made_on_reading`).
pub(super) fn readable_projects<'de, D: Deserializer<'de>>(
    stored: D,
) -> Result<Vec<Project>, D::Error> {
    let stored = Vec::<serde_json::Value>::deserialize(stored)?;
    let read: Vec<ReadProject> = stored.into_iter().filter_map(read_project).collect();
    let mut used: Vec<AvatarColor> = read.iter().filter_map(|r| r.color).collect();
    Ok(read
        .into_iter()
        .map(|read| match read.color {
            Some(color) => read.with_color(color),
            None => {
                let color = AvatarColor::least_used(used.iter().copied());
                used.push(color);
                read.with_color(color)
            }
        })
        .collect())
}

/// Leaves out of `read`, the list as this version read it from `stored`, what reading made instead
/// of read: the avatars of the projects stored before avatars, their colors given by
/// `readable_projects`. A store writing the changes from what it read then stores them with the
/// list's next change, so a project's color no longer depends on the others'. An avatar stored that
/// does not read (a newer version's) is read as none, and stays stored as every such value.
pub fn leave_out_made_on_reading(stored: &serde_json::Value, read: &mut serde_json::Value) {
    let stored = stored.get("projects").and_then(|list| list.as_array());
    let without: HashSet<&str> = stored
        .into_iter()
        .flatten()
        .filter(|project| project.get("avatar").is_none())
        .filter_map(|project| project.get("id")?.as_str())
        .collect();
    let read = read
        .get_mut("projects")
        .and_then(|list| list.as_array_mut());
    for project in read.into_iter().flatten() {
        let made = project
            .get("id")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|id| without.contains(id));
        if let (true, Some(project)) = (made, project.as_object_mut()) {
            project.remove("avatar");
        }
    }
}

/// A stored project, unless it cannot be read.
fn read_project(stored: serde_json::Value) -> Option<ReadProject> {
    serde_json::from_value::<StoredProject>(stored)
        .map_err(|error| error.to_string())
        .and_then(|project| ReadProject::try_from(project).map_err(String::from))
        .inspect_err(|error| tracing::warn!(%error, "a stored project cannot be read"))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::super::contracts::tests::*;
    use super::super::contracts::ProjectList;
    use super::*;

    /// One stored project as the list reads it, if it can be read.
    fn read(project: serde_json::Value) -> Option<Project> {
        let json = serde_json::json!({ "projects": [project], "active": null });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        list.projects.into_iter().next()
    }

    fn color(number: u8) -> AvatarColor {
        AvatarColor::try_from(number).unwrap()
    }

    #[test]
    fn a_project_stored_with_a_location_keeps_its_id() {
        let json = serde_json::json!({
            "id": "wsl:Ubuntu:/home/ale/shop",
            "name": "shop",
            "location": { "kind": "wsl", "distro": "Ubuntu", "root": "/home/ale/shop" }
        });
        let project = read(json).unwrap();
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
        let project = read(json).unwrap();
        assert_eq!(project.folders, [folder("0123456789abcdef", local("/r"))]);
        let two = serde_json::json!({
            "id": "0123456789abcdef",
            "name": "r",
            "folders": [{ "kind": "local", "root": "/r" }, { "id": "x", "kind": "local", "root": "/s" }]
        });
        assert!(read(two).is_none());
        let empty = serde_json::json!({
            "id": "0123456789abcdef",
            "name": "r",
            "folders": [{ "id": "", "kind": "local", "root": "/r" }]
        });
        assert!(read(empty).is_none());
    }

    #[test]
    fn a_project_stored_before_ids_takes_its_location_s() {
        let json = serde_json::json!({
            "name": "shop", "location": { "kind": "wsl", "distro": "Ubuntu", "root": "/s" }
        });
        let project = read(json).unwrap();
        assert_eq!(project.id, "wsl:Ubuntu:/s");
        assert_eq!(
            project,
            Project::stored_before_ids("shop".into(), wsl("Ubuntu", "/s"), AvatarColor::FIRST)
        );
    }

    #[test]
    fn a_project_stored_before_locations_is_a_local_one_with_its_root_as_id() {
        let json =
            serde_json::json!({ "projects": [{ "root": "/r", "name": "r" }], "active": "/r" });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert_eq!(
            list.projects,
            [Project::stored_before_ids(
                "r".into(),
                local("/r"),
                AvatarColor::FIRST
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
                { "name": "t" },
                { "name": "u", "folders": [] },
                { "id": "", "name": "v", "folders": [] }
            ],
            "active": "/r"
        });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        assert_eq!(
            list.projects,
            [Project::stored_before_ids(
                "r".into(),
                local("/r"),
                AvatarColor::FIRST
            )]
        );
    }

    #[test]
    fn projects_stored_without_a_color_take_the_least_used_in_order() {
        let json = serde_json::json!({
            "projects": [
                { "id": "a", "name": "a", "folders": [] },
                { "id": "b", "name": "b", "folders": [], "avatar": { "color": 1, "letters": null } },
                { "id": "c", "name": "c", "folders": [], "avatar": { "color": 42 } },
                { "id": "d", "name": "d", "folders": [], "avatar": { "color": 3, "letters": "DD" } }
            ],
            "active": "a"
        });
        let list = serde_json::from_value::<ProjectList>(json).unwrap();
        let colors: Vec<_> = list.projects.iter().map(|p| p.avatar.color).collect();
        assert_eq!(colors, [color(2), color(1), color(4), color(3)]);
        assert_eq!(list.projects[3].avatar.letters.as_deref(), Some("DD"));
        let again = serde_json::to_value(&list).unwrap();
        assert_eq!(serde_json::from_value::<ProjectList>(again).unwrap(), list);
    }

    #[test]
    fn letters_stored_that_cannot_show_count_as_none() {
        let json = serde_json::json!({
            "id": "a", "name": "a", "folders": [], "avatar": { "color": 2, "letters": "abc" }
        });
        let project = read(json).unwrap();
        assert_eq!(project.avatar, Avatar::of_color(color(2)));
    }

    #[test]
    fn only_the_avatars_reading_made_are_left_out_of_what_was_read() {
        let stored = serde_json::json!({ "projects": [
            { "id": "a", "name": "a", "folders": [] },
            { "id": "b", "name": "b", "folders": [], "avatar": { "color": 42 } }
        ]});
        let mut read =
            serde_json::to_value(serde_json::from_value::<ProjectList>(stored.clone()).unwrap())
                .unwrap();
        leave_out_made_on_reading(&stored, &mut read);
        assert!(read["projects"][0].get("avatar").is_none());
        assert_eq!(read["projects"][1]["avatar"]["color"], 2);
    }
}
