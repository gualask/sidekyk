//! The stored forms of a project, read whole or left out: today's, and the older ones it was
//! stored in before.

use serde::{Deserialize, Deserializer};

use super::contracts::{Location, Project, ProjectFolder};

/// A project as stored: today `{ id, name, folders }`, each folder with its id. Older forms are
/// read too: folders without ids (one at most), one location with its id, one location without
/// (before ids), or a root (before locations), the last two taking their location's id. A folder
/// stored without id was its project's only one, and takes the project's.
#[derive(Deserialize)]
pub(super) struct StoredProject {
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
        let (folders, id) = stored_folders(stored.folders, older, stored.id)?;
        checked_folders(&folders)?;
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
/// edited by hand) is left out, not every project with it.
pub(super) fn readable_projects<'de, D: Deserializer<'de>>(
    stored: D,
) -> Result<Vec<Project>, D::Error> {
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

#[cfg(test)]
mod tests {
    use super::super::contracts::tests::*;
    use super::super::contracts::ProjectList;
    use super::*;

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
}
