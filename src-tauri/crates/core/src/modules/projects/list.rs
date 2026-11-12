//! The list of projects: found, added, merged, renamed, laid out, put on screen and removed. A
//! project's folders change in `list_folders`.

use super::contracts::{Location, Opened, Project, ProjectFolder, ProjectList, TilesLayout};
use super::place::{FoundFolder, NameCase};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// A stored layout is the frontend's: panel ids are short words, and a project has a few panels.
const MAX_PANEL_ID: usize = 32;
const MAX_MINIMIZED: usize = 8;
/// The split a stored layout that is not a number takes.
const EVEN_SPLIT: f64 = 0.5;

impl ProjectList {
    /// A stored list made consistent: no project twice, and an active project whenever there is
    /// one, so a file edited by hand cannot leave the app without a project on screen.
    pub fn normalized(mut self) -> Self {
        let mut seen = std::collections::HashSet::new();
        self.projects.retain(|p| seen.insert(p.id.clone()));
        let projects = &self.projects;
        self.layouts
            .retain(|id, _| projects.iter().any(|p| &p.id == id));
        if self.active().is_none() {
            self.active = self.projects.first().map(|p| p.id.clone());
        }
        self
    }

    pub fn find(&self, id: &str) -> anyhow::Result<&Project> {
        self.projects
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))
    }

    pub fn active(&self) -> Option<&Project> {
        let id = self.active.as_deref()?;
        self.projects.iter().find(|p| p.id == id)
    }

    /// Every project's folders.
    pub fn folders(&self) -> impl Iterator<Item = &Location> {
        self.projects.iter().flat_map(Project::locations)
    }

    /// A folder of a project the user added, and its project. Any other id is refused, so the
    /// frontend cannot point git at a folder of its choosing.
    pub fn folder(&self, id: &str) -> anyhow::Result<(&Project, &ProjectFolder)> {
        self.projects
            .iter()
            .find_map(|p| Some((p, p.folder(id)?)))
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))
    }

    /// The project following the folder at `location`, if one does; this machine's names compared
    /// as `case` says, here and in every method that compares places.
    pub fn at(&self, location: &Location, case: NameCase) -> Option<&Project> {
        self.folder_at(location, case).map(|(project, _)| project)
    }

    /// The folder at `location`, if a project follows it, and that project.
    pub fn folder_at(
        &self,
        location: &Location,
        case: NameCase,
    ) -> Option<(&Project, &ProjectFolder)> {
        self.projects.iter().find_map(|p| {
            let folder = p
                .folders
                .iter()
                .find(|f| f.location.same_place(location, case))?;
            Some((p, folder))
        })
    }

    /// Puts on screen the project following `found`, adding a project at the end, named after the
    /// folder, when none follows it: a folder is one project's. That project comes back, with
    /// the folder to show.
    pub fn open_folder(&mut self, found: FoundFolder, case: NameCase) -> Opened {
        let (id, folder) = match self.folder_at(&found.location, case) {
            Some((project, folder)) => (project.id.clone(), folder.id.clone()),
            None => {
                let project = Project::new(found.name, [found.location]);
                let ids = (project.id.clone(), project.folders[0].id.clone());
                self.projects.push(project);
                ids
            }
        };
        self.active = Some(id.clone());
        Opened::Project {
            id,
            folder_id: folder,
        }
    }

    /// A new project of this name, following `folders` (none, one or several), last; the one on
    /// screen stays, unless there was none. A folder is one project's: one already followed is
    /// refused, and so are folders on two machines or one inside another.
    pub fn add(
        &mut self,
        name: &str,
        folders: Vec<Location>,
        case: NameCase,
    ) -> anyhow::Result<Project> {
        let name = checked_name(name)?;
        for (index, folder) in folders.iter().enumerate() {
            if let Some(other) = self.at(folder, case) {
                anyhow::bail!("that folder is already the project {}", other.id);
            }
            checked_beside(folder, &folders[..index], case)?;
        }
        let project = Project::new(name, folders);
        self.projects.push(project.clone());
        if self.active.is_none() {
            self.active = Some(project.id.clone());
        }
        Ok(project)
    }

    /// Moves the folders of the project `from` into the project `into`, after its own, and
    /// forgets `from`: its notes are the caller's to move first. Refused, changing nothing, when
    /// the folders would be on two machines or one inside another.
    pub fn merge(&mut self, into: &str, from: &str, case: NameCase) -> anyhow::Result<()> {
        self.check_merge(into, from, case)?;
        let moved = self.find(from)?.folders.clone();
        let was_active = self.active.as_deref() == Some(from);
        self.remove(from)?;
        self.project_mut(into)?.folders.extend(moved);
        if was_active {
            self.active = Some(into.to_string());
        }
        Ok(())
    }

    /// Whether the project `from` may be merged into `into` (`merge`), changing nothing: its
    /// folders on the same machine as `into`'s, none overlapping another.
    pub fn check_merge(&self, into: &str, from: &str, case: NameCase) -> anyhow::Result<()> {
        anyhow::ensure!(into != from, "a project merged into itself");
        let target = self.find(into)?;
        let moved = self.find(from)?;
        for (index, folder) in moved.folders.iter().enumerate() {
            let earlier = moved.folders[..index].iter().map(|f| &f.location);
            checked_beside(&folder.location, target.locations().chain(earlier), case)?;
        }
        Ok(())
    }

    pub(super) fn project_mut(&mut self, id: &str) -> anyhow::Result<&mut Project> {
        self.projects
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))
    }

    /// Names a project anew; two projects may share a name.
    pub fn rename(&mut self, id: &str, name: &str) -> anyhow::Result<()> {
        let name = checked_name(name)?;
        self.project_mut(id)?.name = name;
        Ok(())
    }

    pub fn activate(&mut self, id: &str) -> anyhow::Result<()> {
        self.find(id)?;
        self.active = Some(id.to_string());
        Ok(())
    }

    /// Keeps how a project lays out its tiles: the split within its bounds, each panel once.
    pub fn set_layout(&mut self, id: &str, layout: TilesLayout) -> anyhow::Result<()> {
        self.find(id)?;
        let mut seen = std::collections::HashSet::new();
        let mut minimized = layout.minimized;
        minimized.retain(|id| id.len() <= MAX_PANEL_ID && seen.insert(id.clone()));
        minimized.truncate(MAX_MINIMIZED);
        let split = if layout.split.is_finite() {
            layout.split.clamp(0.0, 1.0)
        } else {
            EVEN_SPLIT
        };
        self.layouts
            .insert(id.to_string(), TilesLayout { minimized, split });
        Ok(())
    }

    /// Forgets a project; its repository is left as it is. When it was on screen, the one after
    /// it takes its place, or the one before it when it was the last.
    pub fn remove(&mut self, id: &str) -> anyhow::Result<()> {
        let index = self
            .projects
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))?;
        self.projects.remove(index);
        self.layouts.remove(id);
        if self.active.as_deref() == Some(id) {
            let next = self.projects.get(index).or(self.projects.last());
            self.active = next.map(|p| p.id.clone());
        }
        Ok(())
    }
}

/// Refuses `folder` beside a project's other folders `beside`: on another machine, or one of them,
/// holding one or inside one (files and watchers twice).
pub(super) fn checked_beside<'a>(
    folder: &Location,
    beside: impl IntoIterator<Item = &'a Location>,
    case: NameCase,
) -> anyhow::Result<()> {
    for other in beside {
        if !other.same_machine(folder) {
            return Err(user_facing(UserFacingErrorCode::FolderElsewhere));
        }
        if other.overlaps(folder, case) {
            return Err(user_facing(UserFacingErrorCode::FolderOverlaps));
        }
    }
    Ok(())
}

/// A project's name as given, trimmed; a blank one is refused (the dialog never sends it).
fn checked_name(name: &str) -> anyhow::Result<String> {
    let name = name.trim();
    anyhow::ensure!(!name.is_empty(), "a project needs a name");
    Ok(name.into())
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    /// Names compared as Linux does; the case ignored is told in its own tests.
    pub(crate) const CASE: NameCase = NameCase::Kept;
    use crate::shared::error::user_facing_code;

    /// A project stored before ids, so its id is its root: `/a`.
    pub(crate) fn project(root: &str) -> Project {
        Project::stored_before_ids(
            root.trim_start_matches('/').into(),
            Location::Local { root: root.into() },
        )
    }

    pub(crate) fn list(roots: &[&str], active: Option<&str>) -> ProjectList {
        ProjectList {
            projects: roots.iter().map(|r| project(r)).collect(),
            active: active.map(String::from),
            layouts: Default::default(),
        }
    }

    pub(crate) fn found(root: &str) -> FoundFolder {
        FoundFolder {
            name: root.trim_start_matches('/').into(),
            location: Location::Local { root: root.into() },
        }
    }

    pub(crate) fn roots(projects: &ProjectList) -> Vec<&str> {
        projects
            .projects
            .iter()
            .map(|p| p.folders.first().map_or("", |f| f.location.root()))
            .collect()
    }

    #[test]
    fn a_new_folder_is_a_new_project_on_screen() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.open_folder(found("/c"), CASE);
        assert_eq!(roots(&projects), ["/a", "/b", "/c"]);
        let added = &projects.projects[2];
        assert_eq!(added.name, "c");
        assert_ne!(added.id, "/c");
        assert_eq!(projects.active.as_deref(), Some(added.id.as_str()));
    }

    #[test]
    fn a_folder_already_followed_opens_its_project() {
        let mut projects = list(&["/a", "/b"], Some("/b"));
        projects.open_folder(found("/a/"), CASE);
        assert_eq!(projects, list(&["/a", "/b"], Some("/a")));
    }

    #[test]
    fn a_project_added_by_name_has_no_folder_and_leaves_the_one_on_screen() {
        let mut projects = list(&["/a"], Some("/a"));
        let added = projects.add("  Casa ", vec![], CASE).unwrap();
        assert_eq!((added.name.as_str(), added.folders.len()), ("Casa", 0));
        assert_eq!(projects.active.as_deref(), Some("/a"));
        assert!(projects.add("  ", vec![], CASE).is_err());

        let mut empty = ProjectList::default();
        let first = empty.add("Casa", vec![], CASE).unwrap();
        assert_eq!(empty.active, Some(first.id));
    }

    #[test]
    fn a_project_added_with_a_folder_follows_it_unless_another_does() {
        let mut projects = list(&["/a"], Some("/a"));
        let added = projects
            .add("api", vec![found("/api").location], CASE)
            .unwrap();
        assert_eq!(roots(&projects), ["/a", "/api"]);
        assert_eq!(added.folders[0].location, found("/api").location);
        assert!(projects
            .add("again", vec![found("/a/").location], CASE)
            .is_err());
        assert_eq!(projects.projects.len(), 2);
    }

    pub(crate) fn code(error: anyhow::Error) -> Option<&'static str> {
        user_facing_code(&error).map(UserFacingErrorCode::as_str)
    }

    pub(crate) fn wsl(root: &str) -> Location {
        Location::Wsl {
            distro: "Ubuntu".into(),
            root: root.into(),
        }
    }

    #[test]
    fn a_project_added_with_several_folders_takes_them_on_one_machine_apart() {
        let mut projects = ProjectList::default();
        let shop = projects
            .add(
                "Shop",
                vec![found("/shop/api").location, found("/shop/web").location],
                CASE,
            )
            .unwrap();
        assert_eq!(shop.folders.len(), 2);
        assert_ne!(shop.folders[0].id, shop.folders[1].id);
        let nested = vec![found("/x").location, found("/x/y").location];
        assert_eq!(
            code(projects.add("x", nested, CASE).unwrap_err()),
            Some("folder_overlaps")
        );
        let apart = vec![found("/x").location, wsl("/x")];
        assert_eq!(
            code(projects.add("x", apart, CASE).unwrap_err()),
            Some("folder_elsewhere")
        );
        assert_eq!(projects.projects.len(), 1);
    }

    #[test]
    fn a_folder_of_a_project_is_found_by_its_id_only_in_the_list() {
        let projects = list(&["/a", "/b"], Some("/a"));
        let (project, folder) = projects.folder("/b").unwrap();
        assert_eq!((project.id.as_str(), folder.location.root()), ("/b", "/b"));
        assert_eq!(
            code(projects.folder("/c").unwrap_err()),
            Some("project_not_found")
        );
    }

    #[test]
    fn opening_a_folder_of_a_project_shows_that_folder() {
        let mut projects = list(&["/a"], Some("/a"));
        let shop = projects
            .add(
                "Shop",
                vec![found("/api").location, found("/web").location],
                CASE,
            )
            .unwrap();
        let opened = projects.open_folder(found("/web/"), CASE);
        assert_eq!(projects.active.as_deref(), Some(shop.id.as_str()));
        assert_eq!(
            opened,
            Opened::Project {
                id: shop.id.clone(),
                folder_id: shop.folders[1].id.clone()
            }
        );
    }

    #[test]
    fn a_project_merged_brings_its_folders_and_goes() {
        let mut projects = list(&["/api", "/web", "/ops"], Some("/web"));
        projects.set_layout("/web", layout(0.3)).unwrap();
        projects.merge("/api", "/web", CASE).unwrap();
        assert_eq!(roots(&projects), ["/api", "/ops"]);
        let folders: Vec<&str> = projects.projects[0]
            .folders
            .iter()
            .map(|f| f.id.as_str())
            .collect();
        assert_eq!(folders, ["/api", "/web"]);
        assert_eq!(projects.active.as_deref(), Some("/api"));
        assert!(projects.layouts.is_empty());
        assert!(projects.merge("/api", "/api", CASE).is_err());
        assert!(projects.merge("/api", "/gone", CASE).is_err());

        let mut apart = list(&["/x"], Some("/x"));
        let inside = apart.add("y", vec![found("/x/y").location], CASE).unwrap();
        assert_eq!(
            code(apart.merge("/x", &inside.id, CASE).unwrap_err()),
            Some("folder_overlaps")
        );
        assert_eq!(apart.projects.len(), 2);
    }

    #[test]
    fn a_project_is_renamed_trimmed_and_never_blank() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.rename("/b", " Shop ").unwrap();
        assert_eq!(projects.projects[1].name, "Shop");
        assert!(projects.rename("/b", " ").is_err());
        assert_eq!(projects.projects[1].name, "Shop");
        let error = projects.rename("/gone", "x").unwrap_err();
        assert_eq!(
            user_facing_code(&error),
            Some(UserFacingErrorCode::ProjectNotFound)
        );
    }

    #[test]
    fn only_a_known_project_can_be_activated() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.activate("/b").unwrap();
        assert_eq!(projects.active().map(|p| p.id.as_str()), Some("/b"));

        let error = projects.activate("/elsewhere").unwrap_err();
        assert_eq!(
            user_facing_code(&error),
            Some(UserFacingErrorCode::ProjectNotFound)
        );
        assert_eq!(projects.active.as_deref(), Some("/b"));
    }

    #[test]
    fn removing_the_project_on_screen_shows_the_next_or_the_previous() {
        let mut projects = list(&["/a", "/b", "/c"], Some("/b"));
        projects.remove("/b").unwrap();
        assert_eq!(projects, list(&["/a", "/c"], Some("/c")));

        projects.remove("/c").unwrap();
        assert_eq!(projects, list(&["/a"], Some("/a")));

        projects.remove("/a").unwrap();
        assert_eq!(projects, list(&[], None));
    }

    #[test]
    fn removing_another_project_keeps_the_one_on_screen() {
        let mut projects = list(&["/a", "/b"], Some("/b"));
        projects.remove("/a").unwrap();
        assert_eq!(projects, list(&["/b"], Some("/b")));
        assert!(projects.remove("/a").is_err());
    }

    #[test]
    fn a_stored_list_is_made_consistent() {
        let stored = list(&["/a", "/b", "/a"], Some("/gone"));
        assert_eq!(stored.normalized(), list(&["/a", "/b"], Some("/a")));
        assert_eq!(list(&[], Some("/gone")).normalized(), list(&[], None));
    }

    pub(crate) fn layout(split: f64) -> TilesLayout {
        TilesLayout {
            minimized: vec!["notes".into(), "notes".into()],
            split,
        }
    }

    #[test]
    fn a_layout_is_kept_within_bounds_and_goes_with_its_project() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.set_layout("/a", layout(7.0)).unwrap();
        projects.set_layout("/b", layout(f64::NAN)).unwrap();
        assert_eq!(projects.layouts["/a"].split, 1.0);
        assert_eq!(projects.layouts["/a"].minimized, ["notes"]);
        assert_eq!(projects.layouts["/b"].split, 0.5);
        assert!(projects.set_layout("/gone", layout(0.5)).is_err());

        projects.remove("/a").unwrap();
        assert!(!projects.layouts.contains_key("/a"));
    }

    #[test]
    fn a_stored_layout_of_no_project_is_dropped() {
        let mut stored = list(&["/a"], Some("/a"));
        stored.layouts.insert("/gone".into(), layout(0.5));
        assert!(stored.normalized().layouts.is_empty());
    }
}
