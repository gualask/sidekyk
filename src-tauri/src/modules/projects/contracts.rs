//! Wire contracts shared with the frontend (`src/modules/projects/model/project.types.ts`).

use serde::{Deserialize, Serialize};

use crate::modules::repository::RepositoryInfo;

pub(crate) const PROJECTS_CHANGED_EVENT: &str = "projects-changed";

/// Every project, and the one on screen. Also the form the list is stored in.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectList {
    /// In the order they were added.
    pub(crate) projects: Vec<RepositoryInfo>,
    /// The root of the project on screen: `None` only when there are no projects.
    pub(crate) active: Option<String>,
}

/// Emitted when the list changed without the frontend asking, such as a folder given on the
/// command line while the app runs. The frontend reads the list again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectsChangedEvent {
    pub(crate) version: u8,
}

impl ProjectsChangedEvent {
    pub(crate) fn new() -> Self {
        Self { version: 1 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_list_serializes_with_the_frontend_field_names() {
        let list = ProjectList {
            projects: vec![RepositoryInfo {
                root: "/r".into(),
                name: "r".into(),
            }],
            active: Some("/r".into()),
        };
        let json = serde_json::json!({
            "projects": [{ "root": "/r", "name": "r" }],
            "active": "/r"
        });
        assert_eq!(serde_json::to_value(&list).unwrap(), json);
        assert_eq!(serde_json::from_value::<ProjectList>(json).unwrap(), list);
    }

    #[test]
    fn projects_changed_event_is_versioned() {
        assert_eq!(
            serde_json::to_value(ProjectsChangedEvent::new()).unwrap(),
            serde_json::json!({ "version": 1 })
        );
    }
}
