//! Wire contracts shared with the frontend (`src/modules/projects/model/project.types.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::modules::repository::RepositoryInfo;

pub(crate) const PROJECTS_CHANGED_EVENT: &str = "projects-changed";

/// Every project, and the one on screen. Also the form the list is stored in.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectList {
    /// In the order they were added.
    pub(crate) projects: Vec<RepositoryInfo>,
    /// The root of the project on screen: `None` only when there are no projects.
    pub(crate) active: Option<String>,
    /// How each project lays out its panels' tiles, by root; one never changed is not there. It
    /// goes with its project.
    #[serde(default)]
    pub(crate) layouts: BTreeMap<String, TilesLayout>,
}

/// A project's tiles, as the user left them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TilesLayout {
    /// The panels minimized to the top bar, by id.
    pub(crate) minimized: Vec<String>,
    /// The share of the side column the upper tile takes, between 0 and 1.
    pub(crate) split: f64,
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
            layouts: BTreeMap::from([(
                "/r".into(),
                TilesLayout {
                    minimized: vec!["files".into()],
                    split: 0.4,
                },
            )]),
        };
        let json = serde_json::json!({
            "projects": [{ "root": "/r", "name": "r" }],
            "active": "/r",
            "layouts": { "/r": { "minimized": ["files"], "split": 0.4 } }
        });
        assert_eq!(serde_json::to_value(&list).unwrap(), json);
        assert_eq!(serde_json::from_value::<ProjectList>(json).unwrap(), list);
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
            serde_json::to_value(ProjectsChangedEvent::new()).unwrap(),
            serde_json::json!({ "version": 1 })
        );
    }
}
