//! Wire contracts shared with the frontend (`src/modules/search/model/search.types.ts`).

use serde::{Deserialize, Serialize};

/// What the command palette asks for, at every key typed.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRequest {
    pub(crate) query: String,
    /// The panels' titles, in their order: the frontend defines the panels.
    pub(crate) panels: Vec<String>,
    /// The project whose files are searched: the one on screen, none when all projects show.
    pub(crate) root: Option<String>,
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

/// How a file found changed, as the Files panel colors it; the strongest when it changed in both
/// areas.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ChangeMark {
    Deleted,
    Added,
    Modified,
}

/// A file of the project searched: one git lists, or one deleted that Changes lists.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileMatch {
    pub(crate) path: String,
    /// None when it did not change.
    pub(crate) mark: Option<ChangeMark>,
    /// In the path.
    pub(crate) highlights: Vec<Highlight>,
}

/// A line where the text searched is: its number, its text (cut around the first match when
/// long, `…` marking a cut) and where the text is in it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentLine {
    pub(crate) number: u32,
    pub(crate) text: String,
    pub(crate) highlights: Vec<Highlight>,
}

/// A file's lines where the text searched is, in order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentFile {
    pub(crate) path: String,
    pub(crate) lines: Vec<ContentLine>,
}

/// How a search in contents ended, once its files were all sent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentEnd {
    /// More lines matched than were sent: the search stopped there.
    pub(crate) more: bool,
    /// A newer search, or the palette closing, stopped this one.
    pub(crate) cancelled: bool,
}

/// A list of notes of the project searched.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListMatch {
    pub(crate) id: String,
    pub(crate) name: String,
    /// In the name.
    pub(crate) highlights: Vec<Highlight>,
}

/// Part of a note around the text found in it, on one line, `…` where cut.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snippet {
    pub(crate) text: String,
    pub(crate) highlights: Vec<Highlight>,
}

/// A note of the project searched: its first line matched, or it holds the text typed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteMatch {
    pub(crate) id: String,
    pub(crate) list: String,
    pub(crate) list_name: String,
    /// Its first line that is not blank.
    pub(crate) title: String,
    /// In the title; none when the note was found by its text.
    pub(crate) highlights: Vec<Highlight>,
    /// Where the text typed is in the note, when found that way.
    pub(crate) snippet: Option<Snippet>,
    pub(crate) done: bool,
}

/// The matches, best first in each group. With nothing typed: every project and panel, no files,
/// lists or notes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResults {
    pub(crate) projects: Vec<ProjectMatch>,
    pub(crate) panels: Vec<PanelMatch>,
    pub(crate) files: Vec<FileMatch>,
    /// The files that matched past the ones sent.
    pub(crate) more_files: u32,
    pub(crate) lists: Vec<ListMatch>,
    pub(crate) notes: Vec<NoteMatch>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_and_results_use_the_frontend_field_names() {
        let request: SearchRequest = serde_json::from_value(serde_json::json!({
            "query": "tot",
            "panels": ["Changes"],
            "root": "/r"
        }))
        .unwrap();
        assert_eq!(
            request,
            SearchRequest {
                query: "tot".into(),
                panels: vec!["Changes".into()],
                root: Some("/r".into()),
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
            files: vec![
                FileMatch {
                    path: "src/total.ts".into(),
                    mark: Some(ChangeMark::Added),
                    highlights: vec![[4, 7]],
                },
                FileMatch {
                    path: "README.md".into(),
                    mark: None,
                    highlights: vec![],
                },
            ],
            more_files: 2,
            lists: vec![ListMatch {
                id: "l1".into(),
                name: "Release".into(),
                highlights: vec![[0, 2]],
            }],
            notes: vec![NoteMatch {
                id: "n1".into(),
                list: "l1".into(),
                list_name: "Release".into(),
                title: "Bump version".into(),
                highlights: vec![],
                snippet: Some(Snippet {
                    text: "…the version…".into(),
                    highlights: vec![[5, 12]],
                }),
                done: false,
            }],
        };
        assert_eq!(
            serde_json::to_value(&results).unwrap(),
            serde_json::json!({
                "projects": [{ "root": "/r", "name": "r", "highlights": [[0, 1]] }],
                "panels": [{ "index": 0, "highlights": [] }],
                "files": [
                    { "path": "src/total.ts", "mark": "added", "highlights": [[4, 7]] },
                    { "path": "README.md", "mark": null, "highlights": [] }
                ],
                "moreFiles": 2,
                "lists": [{ "id": "l1", "name": "Release", "highlights": [[0, 2]] }],
                "notes": [{
                    "id": "n1",
                    "list": "l1",
                    "listName": "Release",
                    "title": "Bump version",
                    "highlights": [],
                    "snippet": { "text": "…the version…", "highlights": [[5, 12]] },
                    "done": false
                }]
            })
        );
    }

    #[test]
    fn contents_use_the_frontend_field_names() {
        let files = vec![ContentFile {
            path: "src/a.ts".into(),
            lines: vec![ContentLine {
                number: 12,
                text: "let total;".into(),
                highlights: vec![[4, 9]],
            }],
        }];
        assert_eq!(
            serde_json::to_value(&files).unwrap(),
            serde_json::json!([{
                "path": "src/a.ts",
                "lines": [{ "number": 12, "text": "let total;", "highlights": [[4, 9]] }]
            }])
        );
        let end = ContentEnd {
            more: true,
            cancelled: false,
        };
        assert_eq!(
            serde_json::to_value(&end).unwrap(),
            serde_json::json!({ "more": true, "cancelled": false })
        );
    }
}
