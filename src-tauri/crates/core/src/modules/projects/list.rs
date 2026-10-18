use std::path::{Path, PathBuf};

use super::contracts::{Location, Project, ProjectList, TilesLayout};
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

    /// Adds the project at the end, unless it is already there, and puts it on screen.
    pub fn add(&mut self, project: Project) {
        if self.find(&project.id).is_err() {
            self.projects.push(project.clone());
        }
        self.active = Some(project.id);
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

    /// Whether `path`, on this machine, is inside a local project's repository. `canonical` names
    /// a path as the file system does (links resolved); `ignore_case` compares letters without
    /// case, as macOS and Windows do by default.
    pub fn holds(
        &self,
        path: &Path,
        canonical: impl Fn(&Path) -> PathBuf,
        ignore_case: bool,
    ) -> bool {
        let fold = |path: &Path| -> Vec<String> {
            canonical(path)
                .components()
                .map(|part| {
                    let part = part.as_os_str().to_string_lossy();
                    if ignore_case {
                        part.to_lowercase()
                    } else {
                        part.into_owned()
                    }
                })
                .collect()
        };
        let path = fold(path);
        self.projects.iter().any(|p| {
            p.location
                .local_root()
                .is_some_and(|root| path.starts_with(&fold(Path::new(root))))
        })
    }

    /// Whether `path`, in WSL `distro`, is inside one of its projects' repositories.
    pub fn holds_in_wsl(&self, distro: &str, path: &str) -> bool {
        let parts = |path: &str| -> Vec<String> {
            path.split('/')
                .filter(|part| !part.is_empty())
                .map(String::from)
                .collect()
        };
        let path = parts(path);
        self.projects.iter().any(|p| match &p.location {
            Location::Wsl { distro: d, root } => {
                d.eq_ignore_ascii_case(distro) && path.starts_with(&parts(root))
            }
            Location::Local { .. } => false,
        })
    }

    /// A project found again at `found` (its repository moved): it takes the new place, and the
    /// id that comes with it, in its position, its layout with it, and stays on screen if it was.
    /// When `found` is a project already, the old one goes into it instead.
    pub fn relocate(&mut self, id: &str, found: Project) -> anyhow::Result<()> {
        let index = self
            .projects
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))?;
        if found.id == id {
            return Ok(());
        }
        let was_active = self.active.as_deref() == Some(id);
        let layout = self.layouts.remove(id);
        if self.find(&found.id).is_ok() {
            self.projects.remove(index);
        } else {
            if let Some(layout) = layout {
                self.layouts.insert(found.id.clone(), layout);
            }
            self.projects[index] = found.clone();
        }
        if was_active {
            self.active = Some(found.id);
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::error::user_facing_code;

    fn project(root: &str) -> Project {
        Project::new(
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

    #[test]
    fn adding_appends_once_and_puts_the_project_on_screen() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.add(project("/c"));
        assert_eq!(projects, list(&["/a", "/b", "/c"], Some("/c")));

        projects.add(project("/a"));
        assert_eq!(projects, list(&["/a", "/b", "/c"], Some("/a")));
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
        assert!(projects.holds(Path::new("/Dev/Shop/notes.md"), same, false));
        assert!(!projects.holds(Path::new("/Dev/Shopping/notes.md"), same, false));
        assert!(!projects.holds(Path::new("/dev/shop/notes.md"), same, false));
        assert!(projects.holds(Path::new("/dev/shop/notes.md"), same, true));
        // a link to the repository, as the file system resolves it
        let resolved =
            |path: &Path| PathBuf::from(path.to_string_lossy().replace("/link", "/Dev/Shop"));
        assert!(projects.holds(Path::new("/link/notes.md"), resolved, false));
    }

    #[test]
    fn a_wsl_project_holds_no_path_of_this_machine() {
        let mut projects = list(&[], None);
        projects.add(Project::new(
            "shop".into(),
            Location::Wsl {
                distro: "Ubuntu".into(),
                root: "/home/ale/shop".into(),
            },
        ));
        let same = |path: &Path| path.to_path_buf();
        assert!(!projects.holds(Path::new("/home/ale/shop/notes.md"), same, false));
        assert!(projects.holds_in_wsl("Ubuntu", "/home/ale/shop/notes.md"));
        assert!(projects.holds_in_wsl("ubuntu", "/home/ale/shop"));
        assert!(!projects.holds_in_wsl("Ubuntu", "/home/ale/shopping/notes.md"));
        assert!(!projects.holds_in_wsl("Debian", "/home/ale/shop/notes.md"));
    }

    #[test]
    fn a_project_found_elsewhere_keeps_its_place_and_layout() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.set_layout("/a", layout(0.3)).unwrap();
        projects.relocate("/a", project("/moved")).unwrap();
        assert_eq!(
            projects
                .projects
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
            ["/moved", "/b"]
        );
        assert_eq!(projects.active.as_deref(), Some("/moved"));
        assert_eq!(projects.layouts["/moved"].split, 0.3);
        assert!(!projects.layouts.contains_key("/a"));
    }

    #[test]
    fn a_project_found_at_another_project_goes_into_it() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.relocate("/a", project("/b")).unwrap();
        assert_eq!(projects, list(&["/b"], Some("/b")));
        assert!(projects.relocate("/gone", project("/c")).is_err());
    }
}
