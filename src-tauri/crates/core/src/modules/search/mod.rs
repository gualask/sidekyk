//! The command palette's search: what was typed, ranked against the projects and the note lists and
//! notes of every book at all projects, or the panels and the files, note lists and notes of the
//! project on screen (`⌘K`); or looked for in those files' contents (`⌘F`). Names are ranked from
//! what the caller hands over; contents are read through the repository's port. The Move dialog
//! ranks its projects and lists the same way (`rank_names`).

mod contents;
mod contracts;
mod notes;
mod rank;

pub use contents::{narrows, search_contents, ContentSearch};
pub use contracts::{
    ContentEnd, ContentFile, FileMatch, FileMatches, ListMatch, NoteMatch, SearchRequest,
    SearchResults,
};
pub use notes::{search_every_book, search_notes};

use std::collections::HashMap;
use std::sync::Arc;

use contracts::{ChangeMark, PanelMatch, ProjectMatch};
use rank::{Ranker, Texts};

use crate::modules::projects::Project;
use crate::modules::repository::{ChangeKind, ChangedFile, FileTree};

/// At most this many files go back: the palette shows the best, the rest are counted.
const FILE_LIMIT: usize = 500;

/// A project's files: those git lists, and how they changed as its last snapshot found.
pub struct ProjectFiles {
    pub tree: Arc<FileTree>,
    pub changed: Arc<[ChangedFile]>,
}

/// Ranks the panels and the files, lists and notes of the project the request names against the
/// query, or the projects and the lists and notes of every book when it names none. With nothing
/// typed, every panel or project in their order and no file, list or note: the palette opens on
/// where to go. `files_of`, `notes_of` and `every_notes` are asked only once something is typed, as
/// listing a project's files may run git and notes be read from disk; each ranks them where they
/// are kept (`search_files`, `search_notes`, `search_every_book`).
pub fn search(
    request: &SearchRequest,
    projects: &[Project],
    files_of: impl FnOnce(&str) -> Option<FileMatches>,
    notes_of: impl FnOnce(&str) -> Option<(Vec<ListMatch>, Vec<NoteMatch>)>,
    every_notes: impl FnOnce() -> (Vec<ListMatch>, Vec<NoteMatch>),
) -> SearchResults {
    let mut names = Ranker::new(&request.query, Texts::Names);

    let projects = if request.project_id.is_some() {
        Vec::new()
    } else {
        let project_names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        let (ranked, _) = names.rank(&project_names, usize::MAX);
        ranked
            .into_iter()
            .map(|r| ProjectMatch {
                project: projects[r.index].clone(),
                score: r.score,
                highlights: r.highlights,
            })
            .collect()
    };

    let panel_titles: Vec<&str> = request.panels.iter().map(String::as_str).collect();
    let (ranked, _) = names.rank(&panel_titles, usize::MAX);
    let panels = ranked
        .into_iter()
        .map(|r| PanelMatch {
            index: r.index as u32,
            score: r.score,
            highlights: r.highlights,
        })
        .collect();

    let typed = !names.is_empty();
    let project = request.project_id.as_deref().filter(|_| typed);
    let FileMatches {
        files,
        more: more_files,
    } = project.and_then(files_of).unwrap_or_default();
    let (lists, notes) = match request.project_id {
        Some(_) => project.and_then(notes_of).unwrap_or_default(),
        None if typed => every_notes(),
        None => Default::default(),
    };

    SearchResults {
        projects,
        panels,
        files,
        more_files,
        lists,
        notes,
    }
}

/// The names that match `query`, best first, as the palette ranks projects: where to move notes
/// (the Move dialog's projects and lists). With nothing typed, every name in its order.
pub fn rank_names(query: &str, names: &[&str]) -> Vec<usize> {
    let (best, _) = Ranker::new(query, Texts::Names).best(names, usize::MAX);
    best.into_iter().map(|scored| scored.index).collect()
}

/// The files of a project that match `query` best, and how many more did. A deleted file is not
/// in the tree, but Changes lists it: it is searched too.
pub fn search_files(query: &str, files: &ProjectFiles) -> FileMatches {
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
    let files = ranked
        .into_iter()
        .map(|r| FileMatch {
            path: paths[r.index].to_string(),
            mark: marks.get(paths[r.index]).copied(),
            score: r.score,
            highlights: r.highlights,
        })
        .collect();
    FileMatches { files, more }
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
    use crate::modules::projects::Location;
    use crate::modules::repository::ChangeArea;

    fn project(name: &str) -> Project {
        Project::new(
            name.into(),
            Some(Location::Local {
                root: format!("/dev/{name}"),
            }),
        )
    }

    #[test]
    fn names_rank_best_first_and_all_in_order_with_nothing_typed() {
        let names = ["Calcetto", "Thesis", "Casa", "Ca shop"];
        assert_eq!(rank_names("cas", &names), vec![2, 3]);
        // equal scores keep the names' order
        assert_eq!(rank_names("ca", &names), vec![0, 2, 3]);
        assert_eq!(rank_names(" ", &names), vec![0, 1, 2, 3]);
        assert!(rank_names("zz", &names).is_empty());
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
            project_id: Some("/dev/shop".into()),
        }
    }

    /// The files of a project that match `query`, as the holder of its files ranks them.
    fn files(query: &str, paths: &[&str], changed: &[ChangedFile]) -> FileMatches {
        let files = ProjectFiles {
            tree: Arc::new(FileTree::from_paths(paths.iter().copied())),
            changed: changed.into(),
        };
        search_files(query, &files)
    }

    #[test]
    fn nothing_typed_lists_the_panels_but_no_files() {
        let results = search(
            &request(" "),
            &[project("shop"), project("docs")],
            |_| panic!("nothing typed lists no file"),
            |_| panic!("nothing typed reads no note"),
            || panic!("nothing typed reads no note"),
        );
        assert!(results.projects.is_empty());
        assert_eq!(results.panels.len(), 2);
        assert!(results.files.is_empty());
        assert_eq!(results.more_files, 0);
    }

    #[test]
    fn without_a_project_the_projects_are_ranked() {
        let mut all = request(" ");
        all.project_id = None;
        let mut found = |query: &str| {
            all.query = query.into();
            let results = search(
                &all,
                &[project("shop"), project("cache-hub")],
                |_| None,
                |_| None,
                Default::default,
            );
            results
                .projects
                .into_iter()
                .map(|p| p.project.name)
                .collect::<Vec<_>>()
        };
        assert_eq!(found(" "), ["shop", "cache-hub"]);
        assert_eq!(found("ch"), ["cache-hub"]);
    }

    #[test]
    fn without_a_project_every_book_is_searched_once_something_is_typed() {
        let mut all = request(" ");
        all.project_id = None;
        let none = search(
            &all,
            &[project("shop")],
            |_| panic!("no project to list"),
            |_| panic!("no project to read"),
            || panic!("nothing typed reads no note"),
        );
        assert!(none.notes.is_empty());
        all.query = "plan".into();
        let found = |book: &str| NoteMatch {
            book: book.into(),
            id: "n".into(),
            list: "l".into(),
            list_name: "General".into(),
            title: "plan".into(),
            score: 1,
            highlights: Vec::new(),
            snippet: None,
        };
        let results = search(
            &all,
            &[project("shop")],
            |_| panic!("no project to list"),
            |_| panic!("one project's notes are asked inside it"),
            || (Vec::new(), vec![found("inbox")]),
        );
        assert_eq!(results.notes, [found("inbox")]);
        assert!(results.files.is_empty());
    }

    #[test]
    fn a_query_ranks_the_panels_and_the_files_but_no_project() {
        let results = search(
            &request("ch"),
            &[project("shop"), project("cache-hub")],
            |project| {
                assert_eq!(project, "/dev/shop");
                Some(files("ch", &["src/cart/checkout.ts", "README.md"], &[]))
            },
            |_| None,
            || panic!("inside a project only its notes"),
        );
        assert!(results.projects.is_empty());
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
            |_| Some(files("ts", &["a.ts", "b.ts", "c.ts", "back.ts"], &changed)),
            |_| None,
            Default::default,
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
        all.project_id = None;
        let results = search(
            &all,
            &[project("shop")],
            |_| panic!("no project to list"),
            |_| panic!("no project to read"),
            Default::default,
        );
        assert!(results.files.is_empty());
        // a project whose files cannot be read offers none
        assert!(
            search(&request("ts"), &[], |_| None, |_| None, Default::default)
                .files
                .is_empty()
        );
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
            |_| Some(files("file", &paths, &[])),
            |_| None,
            Default::default,
        );
        assert_eq!(results.files.len(), FILE_LIMIT);
        assert_eq!(results.more_files, 7);
    }
}
