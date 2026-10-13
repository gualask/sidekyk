//! Wire contracts shared with the frontend (`src/modules/search/model/search.types.ts`).

use serde::{Deserialize, Serialize};

use crate::modules::repository::ChangeArea;

/// What the command palette asks for, at every key typed.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRequest {
    pub(crate) query: String,
    /// The panels' titles, in their order: the frontend defines the panels.
    pub(crate) panels: Vec<String>,
}

/// Where the query's letters are in a text: UTF-16 offsets `[start, end)`, as JavaScript counts.
pub(crate) type Highlight = [u32; 2];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMatch {
    pub(crate) root: String,
    pub(crate) name: String,
    /// In the name.
    pub(crate) highlights: Vec<Highlight>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PanelMatch {
    /// The panel's position in the request.
    pub(crate) index: u32,
    /// In the title.
    pub(crate) highlights: Vec<Highlight>,
}

/// A changed file of the project on screen, in one area, as the Changes panel lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileMatch {
    pub(crate) path: String,
    pub(crate) area: ChangeArea,
    /// In the path.
    pub(crate) highlights: Vec<Highlight>,
}

/// The matches, best first in each group. With nothing typed: every project and panel, no files.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResults {
    pub(crate) projects: Vec<ProjectMatch>,
    pub(crate) panels: Vec<PanelMatch>,
    pub(crate) files: Vec<FileMatch>,
    /// The files that matched past the ones sent.
    pub(crate) more_files: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_and_results_use_the_frontend_field_names() {
        let request: SearchRequest =
            serde_json::from_value(serde_json::json!({ "query": "tot", "panels": ["Changes"] }))
                .unwrap();
        assert_eq!(
            request,
            SearchRequest {
                query: "tot".into(),
                panels: vec!["Changes".into()],
            }
        );

        let results = SearchResults {
            projects: vec![ProjectMatch {
                root: "/r".into(),
                name: "r".into(),
                highlights: vec![[0, 1]],
            }],
            panels: vec![PanelMatch {
                index: 0,
                highlights: vec![],
            }],
            files: vec![FileMatch {
                path: "src/total.ts".into(),
                area: ChangeArea::Unstaged,
                highlights: vec![[4, 7]],
            }],
            more_files: 2,
        };
        assert_eq!(
            serde_json::to_value(&results).unwrap(),
            serde_json::json!({
                "projects": [{ "root": "/r", "name": "r", "highlights": [[0, 1]] }],
                "panels": [{ "index": 0, "highlights": [] }],
                "files": [{ "path": "src/total.ts", "area": "unstaged", "highlights": [[4, 7]] }],
                "moreFiles": 2
            })
        );
    }
}
