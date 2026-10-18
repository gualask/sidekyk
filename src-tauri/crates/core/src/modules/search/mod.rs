//! The command palette's search: what was typed, ranked against the projects, the panels and the
//! files, note lists and notes of the project on screen (`⌘K`), or looked for in those files' contents (`⌘F`). Names are
//! ranked from what the caller hands over; contents are read through the repository's port.

mod contents;
mod contracts;
mod notes;
mod rank;

pub use contents::{narrows, search_contents, ContentSearch};
pub use contracts::{
    ContentEnd, ContentFile, ListMatch, NoteMatch, SearchRequest, SearchResults,
};
pub use notes::search_notes;

use std::collections::HashMap;
use std::sync::Arc;

use contracts::{ChangeMark, FileMatch, PanelMatch, ProjectMatch};
use rank::{Ranker, Texts};

use crate::modules::repository::{ChangeKind, ChangedFile, FileTree, RepositoryInfo};

/// At most this many files go back: the palette shows the best, the rest are counted.
const FILE_LIMIT: usize = 500;

/// Threads a search runs on at most, so a key typed never takes the whole machine.
const MAX_THREADS: usize = 8;

fn threads() -> usize {
    std::thread::available_parallelism()
        .map_or(1, std::num::NonZero::get)
        .min(MAX_THREADS)
}

/// A project's files: those git lists, and how they changed as its last snapshot found.
pub struct ProjectFiles {
    pub tree: Arc<FileTree>,
    pub changed: Arc<[ChangedFile]>,
}

/// Ranks the projects, the panels and the files, lists and notes of the project the request names
/// against the query. With nothing typed, every project and panel in their order and nothing of
/// the project: the palette opens on where to go. `files_of` and `notes_of` are asked only once
/// something is typed, as listing a project's files may run git and its notes be read from disk;
/// `notes_of` ranks them where they are kept (`search_notes`).
pub fn search(
    request: &SearchRequest,
    projects: &[RepositoryInfo],
    files_of: impl FnOnce(&str) -> Option<ProjectFiles>,
    notes_of: impl FnOnce(&str) -> Option<(Vec<ListMatch>, Vec<NoteMatch>)>,
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

    let root = request.root.as_deref().filter(|_| !names.is_empty());
    let (files, more_files) = root.and_then(files_of).map_or((Vec::new(), 0), |files| {
        search_files(&request.query, &files)
    });
    let (lists, notes) = root.and_then(notes_of).unwrap_or_default();

    SearchResults {
        projects,
        panels,
        files,
        more_files,
        lists,
        notes,
    }
}

/// The best files, and how many more matched. A deleted file is not in the tree, but Changes
/// lists it: it is searched too.
fn search_files(query: &str, files: &ProjectFiles) -> (Vec<FileMatch>, u32) {
    let mut deleted: Vec<&str> = files
        .changed
        .iter()
        .filter(|f| f.kind == ChangeKind::Deleted && !files.tree.contains_file(&f.path))
        .map(|f| f.path.as_str())
        .collect();
    // sorted as the tree's files, so equal scores always come in the same order
    deleted.sort_unstable();
    deleted.dedup();
    let paths: Vec<&str> = files
        .tree
        .files()
        .iter()
        .map(String::as_str)
        .chain(deleted)
        .collect();
    let (ranked, total) = Ranker::new(query, Texts::Paths).rank(&paths, FILE_LIMIT);
    let more = (total - ranked.len()) as u32;
    let marks = marks_by_path(&files.changed);
    let matches = ranked
        .into_iter()
        .map(|r| FileMatch {
            path: paths[r.index].to_string(),
            mark: marks.get(paths[r.index]).copied(),
            highlights: r.highlights,
        })
        .collect();
    (matches, more)
}

/// How each changed path changed, the strongest of its areas: an edit over a new file over a
/// deletion, as the Files panel colors it (`changeMarks` in
/// `src/modules/repository/model/file-tree.ts`: change both together).
fn marks_by_path(changed: &[ChangedFile]) -> HashMap<&str, ChangeMark> {
    let mut marks: HashMap<&str, ChangeMark> = HashMap::new();
    for file in changed {
        let mark = match file.kind {
            ChangeKind::Deleted => ChangeMark::Deleted,
            ChangeKind::Untracked
            | ChangeKind::Added
            | ChangeKind::Renamed
            | ChangeKind::Copied => ChangeMark::Added,
            _ => ChangeMark::Modified,
        };
        let strongest = marks.entry(&file.path).or_insert(mark);
        *strongest = (*strongest).max(mark);
    }
    marks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::repository::ChangeArea;

    fn project(name: &str) -> RepositoryInfo {
        RepositoryInfo {
            root: format!("/dev/{name}"),
            name: name.into(),
        }
    }

    fn change(path: &str, area: ChangeArea, kind: ChangeKind) -> ChangedFile {
        ChangedFile {
            path: path.into(),
            orig_path: None,
            area,
            kind,
            additions: Some(1),
            deletions: Some(0),
            binary: false,
        }
    }

    fn request(query: &str) -> SearchRequest {
        SearchRequest {
            query: query.into(),
            panels: vec!["Changes".into(), "Files".into()],
            root: Some("/dev/shop".into()),
        }
    }

    fn files(paths: &[&str], changed: &[ChangedFile]) -> ProjectFiles {
        ProjectFiles {
            tree: Arc::new(FileTree::from_paths(paths.iter().copied())),
            changed: changed.into(),
        }
    }

    #[test]
    fn nothing_typed_lists_projects_and_panels_but_no_files() {
        let results = search(
            &request(" "),
            &[project("shop"), project("docs")],
            |_| panic!("nothing typed lists no file"),
            |_| panic!("nothing typed reads no note"),
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
            |root| {
                assert_eq!(root, "/dev/shop");
                Some(files(&["src/cart/checkout.ts", "README.md"], &[]))
            },
            |_| None,
        );
        assert_eq!(results.projects.len(), 1);
        assert_eq!(results.projects[0].name, "cache-hub");
        assert_eq!(results.panels.len(), 1);
        assert_eq!(results.panels[0].index, 0);
        assert_eq!(results.files.len(), 1);
        assert_eq!(results.files[0].path, "src/cart/checkout.ts");
        assert_eq!(results.files[0].mark, None);
    }

    #[test]
    fn a_file_takes_its_strongest_change_and_a_deleted_one_is_found() {
        let changed = [
            change("a.ts", ChangeArea::Staged, ChangeKind::Added),
            change("a.ts", ChangeArea::Unstaged, ChangeKind::Modified),
            change("b.ts", ChangeArea::Untracked, ChangeKind::Untracked),
            change("gone.ts", ChangeArea::Unstaged, ChangeKind::Deleted),
            // deleted from the index, then written again
            change("back.ts", ChangeArea::Staged, ChangeKind::Deleted),
            change("back.ts", ChangeArea::Untracked, ChangeKind::Untracked),
        ];
        let results = search(
            &request("ts"),
            &[],
            |_| Some(files(&["a.ts", "b.ts", "c.ts", "back.ts"], &changed)),
            |_| None,
        );
        let found: HashMap<&str, Option<ChangeMark>> = results
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.mark))
            .collect();
        assert_eq!(results.files.len(), 5);
        assert_eq!(found["a.ts"], Some(ChangeMark::Modified));
        assert_eq!(found["b.ts"], Some(ChangeMark::Added));
        assert_eq!(found["c.ts"], None);
        assert_eq!(found["gone.ts"], Some(ChangeMark::Deleted));
        assert_eq!(found["back.ts"], Some(ChangeMark::Added));
    }

    #[test]
    fn without_a_project_no_file_is_searched() {
        let mut all = request("ts");
        all.root = None;
        let results = search(
            &all,
            &[project("shop")],
            |_| panic!("no project to list"),
            |_| panic!("no project to read"),
        );
        assert!(results.files.is_empty());
        // a project whose files cannot be read offers none
        assert!(search(&request("ts"), &[], |_| None, |_| None)
            .files
            .is_empty());
    }

    #[test]
    fn files_past_the_limit_are_counted() {
        let paths: Vec<String> = (0..FILE_LIMIT + 7)
            .map(|i| format!("src/file{i}.ts"))
            .collect();
        let paths: Vec<&str> = paths.iter().map(String::as_str).collect();
        let results = search(
            &request("file"),
            &[],
            |_| Some(files(&paths, &[])),
            |_| None,
        );
        assert_eq!(results.files.len(), FILE_LIMIT);
        assert_eq!(results.more_files, 7);
    }
}
