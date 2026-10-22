use std::path::{Path, PathBuf};

use super::contracts::{Location, Project, ProjectList, TilesLayout};
use super::place::{linux_parts, local_parts, same_distro, FoundFolder, IGNORE_CASE};
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
        self.projects.iter().flat_map(|p| &p.folders)
    }

    /// The project following the folder at `location`, if one does.
    pub fn at(&self, location: &Location) -> Option<&Project> {
        self.projects
            .iter()
            .find(|p| p.folders.iter().any(|f| f.same_place(location)))
    }

    /// Puts on screen the project following `found`, adding one at the end, named after the
    /// folder, when none does: a folder is one project's.
    pub fn open_folder(&mut self, found: FoundFolder) {
        let id = match self.at(&found.location) {
            Some(project) => project.id.clone(),
            None => {
                let project = Project::new(found.name, Some(found.location));
                let id = project.id.clone();
                self.projects.push(project);
                id
            }
        };
        self.active = Some(id);
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

    /// Whether `path`, on this machine, is inside a local project's folder, compared as the file
    /// system does. `canonical` names a path as the file system does (links resolved).
    pub fn holds(&self, path: &Path, canonical: impl Fn(&Path) -> PathBuf) -> bool {
        self.holds_as(path, canonical, IGNORE_CASE)
    }

    fn holds_as(
        &self,
        path: &Path,
        canonical: impl Fn(&Path) -> PathBuf,
        ignore_case: bool,
    ) -> bool {
        let parts = |path: &Path| local_parts(&canonical(path), ignore_case);
        let path = parts(path);
        self.folders()
            .filter_map(Location::local_root)
            .any(|root| path.starts_with(&parts(Path::new(root))))
    }

    /// Whether `path`, in WSL `distro`, is inside one of its projects' folders.
    pub fn holds_in_wsl(&self, distro: &str, path: &str) -> bool {
        let path = linux_parts(path);
        self.folders().any(|folder| match folder {
            Location::Wsl { distro: d, root } => {
                same_distro(d, distro) && path.starts_with(&linux_parts(root))
            }
            Location::Local { .. } => false,
        })
    }

    /// A project's folder found again at `found` (it moved): the project follows it there, and
    /// keeps its id, name, notes and layout. When `found` is another project's folder, nothing
    /// changes and that project comes back: a folder is one project's.
    pub fn relocate(&mut self, id: &str, found: FoundFolder) -> anyhow::Result<Option<Project>> {
        let index = self
            .projects
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))?;
        if let Some(other) = self.at(&found.location).filter(|p| p.id != id) {
            return Ok(Some(other.clone()));
        }
        self.projects[index].folders = vec![found.location];
        Ok(None)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::error::user_facing_code;

    /// A project stored before ids, so its id is its root: `/a`.
    fn project(root: &str) -> Project {
        Project::stored_before_ids(
            root.trim_start_matches('/').into(),
            Location::Local { root: root.into() },
        )
    }

    fn list(roots: &[&str], active: Option<&str>) -> ProjectList {
        ProjectList {
            projects: roots.iter().map(|r| project(r)).collect(),
            active: active.map(String::from),
            layouts: Default::default(),
        }
    }

    fn found(root: &str) -> FoundFolder {
        FoundFolder {
            name: root.trim_start_matches('/').into(),
            location: Location::Local { root: root.into() },
        }
    }

    fn roots(projects: &ProjectList) -> Vec<&str> {
        projects
            .projects
            .iter()
            .map(|p| p.folder().map_or("", Location::root))
            .collect()
    }

    #[test]
    fn a_new_folder_is_a_new_project_on_screen() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.open_folder(found("/c"));
        assert_eq!(roots(&projects), ["/a", "/b", "/c"]);
        let added = &projects.projects[2];
        assert_eq!(added.name, "c");
        assert_ne!(added.id, "/c");
        assert_eq!(projects.active.as_deref(), Some(added.id.as_str()));
    }

    #[test]
    fn a_folder_already_followed_opens_its_project() {
        let mut projects = list(&["/a", "/b"], Some("/b"));
        projects.open_folder(found("/a/"));
        assert_eq!(projects, list(&["/a", "/b"], Some("/a")));
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

    fn layout(split: f64) -> TilesLayout {
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

    #[test]
    fn a_path_inside_a_repository_is_found_however_it_is_written() {
        let projects = list(&["/Dev/Shop"], Some("/Dev/Shop"));
        let same = |path: &Path| path.to_path_buf();
        assert!(projects.holds_as(Path::new("/Dev/Shop/notes.md"), same, false));
        assert!(!projects.holds_as(Path::new("/Dev/Shopping/notes.md"), same, false));
        assert!(!projects.holds_as(Path::new("/dev/shop/notes.md"), same, false));
        assert!(projects.holds_as(Path::new("/dev/shop/notes.md"), same, true));
        // a link to the repository, as the file system resolves it
        let resolved =
            |path: &Path| PathBuf::from(path.to_string_lossy().replace("/link", "/Dev/Shop"));
        assert!(projects.holds_as(Path::new("/link/notes.md"), resolved, false));
    }

    #[test]
    fn a_wsl_project_holds_no_path_of_this_machine() {
        let mut projects = list(&[], None);
        projects.open_folder(FoundFolder {
            name: "shop".into(),
            location: Location::Wsl {
                distro: "Ubuntu".into(),
                root: "/home/ale/shop".into(),
            },
        });
        let same = |path: &Path| path.to_path_buf();
        assert!(!projects.holds_as(Path::new("/home/ale/shop/notes.md"), same, false));
        assert!(projects.holds_in_wsl("Ubuntu", "/home/ale/shop/notes.md"));
        assert!(projects.holds_in_wsl("ubuntu", "/home/ale/shop"));
        assert!(!projects.holds_in_wsl("Ubuntu", "/home/ale/shopping/notes.md"));
        assert!(!projects.holds_in_wsl("Debian", "/home/ale/shop/notes.md"));
    }

    #[test]
    fn a_project_found_elsewhere_keeps_its_id_name_place_and_layout() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.set_layout("/a", layout(0.3)).unwrap();
        assert_eq!(projects.relocate("/a", found("/moved")).unwrap(), None);
        assert_eq!(roots(&projects), ["/moved", "/b"]);
        let moved = &projects.projects[0];
        assert_eq!((moved.id.as_str(), moved.name.as_str()), ("/a", "a"));
        assert_eq!(projects.active.as_deref(), Some("/a"));
        assert_eq!(projects.layouts["/a"].split, 0.3);
    }

    #[test]
    fn a_folder_of_another_project_is_not_taken() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        let other = projects.relocate("/a", found("/b")).unwrap();
        assert_eq!(other.map(|p| p.id), Some("/b".into()));
        assert_eq!(projects, list(&["/a", "/b"], Some("/a")));
        assert_eq!(projects.relocate("/a", found("/a")).unwrap(), None);
        assert!(projects.relocate("/gone", found("/c")).is_err());
    }
}
