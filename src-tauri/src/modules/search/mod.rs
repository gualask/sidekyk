//! The command palette's search: what was typed, ranked against the projects, the panels and the
//! changed files of the project on screen. Pure: the caller hands over what to search, nothing is
//! read from disk or git.

mod contracts;
mod rank;

pub(crate) use contracts::{SearchRequest, SearchResults};

use contracts::{FileMatch, PanelMatch, ProjectMatch};
use rank::{Ranker, Texts};

use crate::modules::repository::{ChangedFile, RepositoryInfo};

/// At most this many files go back: the palette shows the best, the rest are counted.
const FILE_LIMIT: usize = 500;

/// Ranks the projects, the panels and the files against the query. With nothing typed, every
/// project and panel in their order and no file: the palette opens on where to go.
pub(crate) fn search(
    request: &SearchRequest,
    projects: &[RepositoryInfo],
    files: &[ChangedFile],
) -> SearchResults {
    let mut names = Ranker::new(&request.query, Texts::Names);

    let project_names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
    let (ranked, _) = names.rank(&project_names, usize::MAX);
    let projects = ranked
        .into_iter()
        .map(|r| ProjectMatch {
            root: projects[r.index].root.clone(),
            name: projects[r.index].name.clone(),
            highlights: r.highlights,
        })
        .collect();

    let panel_titles: Vec<&str> = request.panels.iter().map(String::as_str).collect();
    let (ranked, _) = names.rank(&panel_titles, usize::MAX);
    let panels = ranked
        .into_iter()
        .map(|r| PanelMatch {
            index: r.index as u32,
            highlights: r.highlights,
        })
        .collect();

    let (files, more_files) = if names.is_empty() {
        (Vec::new(), 0)
    } else {
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        let (ranked, total) = Ranker::new(&request.query, Texts::Paths).rank(&paths, FILE_LIMIT);
        let more = (total - ranked.len()) as u32;
        let matches = ranked
            .into_iter()
            .map(|r| FileMatch {
                path: files[r.index].path.clone(),
                area: files[r.index].area,
                highlights: r.highlights,
            })
            .collect();
        (matches, more)
    };

    SearchResults {
        projects,
        panels,
        files,
        more_files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::repository::{ChangeArea, ChangeKind};

    fn project(name: &str) -> RepositoryInfo {
        RepositoryInfo {
            root: format!("/dev/{name}"),
            name: name.into(),
        }
    }

    fn file(path: &str, area: ChangeArea) -> ChangedFile {
        ChangedFile {
            path: path.into(),
            orig_path: None,
            area,
            kind: ChangeKind::Modified,
            additions: Some(1),
            deletions: Some(0),
            binary: false,
        }
    }

    fn request(query: &str) -> SearchRequest {
        SearchRequest {
            query: query.into(),
            panels: vec!["Changes".into(), "Files".into()],
        }
    }

    #[test]
    fn nothing_typed_lists_projects_and_panels_but_no_files() {
        let results = search(
            &request(""),
            &[project("shop"), project("docs")],
            &[file("src/total.ts", ChangeArea::Unstaged)],
        );
        let names: Vec<_> = results.projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["shop", "docs"]);
        assert_eq!(results.panels.len(), 2);
        assert!(results.files.is_empty());
        assert_eq!(results.more_files, 0);
    }

    #[test]
    fn a_query_ranks_every_group() {
        let results = search(
            &request("ch"),
            &[project("shop"), project("cache-hub")],
            &[
                file("src/cart/checkout.ts", ChangeArea::Staged),
                file("README.md", ChangeArea::Untracked),
            ],
        );
        assert_eq!(results.projects.len(), 1);
        assert_eq!(results.projects[0].name, "cache-hub");
        assert_eq!(results.panels.len(), 1);
        assert_eq!(results.panels[0].index, 0);
        assert_eq!(results.files.len(), 1);
        assert_eq!(results.files[0].path, "src/cart/checkout.ts");
        assert_eq!(results.files[0].area, ChangeArea::Staged);
    }

    #[test]
    fn files_past_the_limit_are_counted() {
        let files: Vec<_> = (0..FILE_LIMIT + 7)
            .map(|i| file(&format!("src/file{i}.ts"), ChangeArea::Unstaged))
            .collect();
        let results = search(&request("file"), &[], &files);
        assert_eq!(results.files.len(), FILE_LIMIT);
        assert_eq!(results.more_files, 7);
    }
}
