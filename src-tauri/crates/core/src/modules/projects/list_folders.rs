//! A project's folders: added, stopped following, found again elsewhere, picked for a new
//! project, and the paths they hold.

use std::path::{Path, PathBuf};

use super::contracts::{FolderChoice, FolderInside, Location, Project, ProjectFolder, ProjectList};
use super::list::checked_beside;
use super::place::{linux_parts, local_parts, same_distro, FoundFolder, NameCase};
use crate::shared::error::{user_facing, UserFacingErrorCode};

impl ProjectList {
    /// Adds the folder found at `found` to the project `id`, last. When it is
    /// another project's, nothing changes and that project comes back: a folder is one
    /// project's, and that project may be merged into this one (`merge`).
    pub fn add_folder(
        &mut self,
        id: &str,
        found: FoundFolder,
        case: NameCase,
    ) -> anyhow::Result<Option<Project>> {
        let project = self.find(id)?;
        if let Some(other) = self.at(&found.location, case).filter(|p| p.id != id) {
            return Ok(Some(other.clone()));
        }
        checked_beside(&found.location, project.locations(), case)?;
        self.project_mut(id)?
            .folders
            .push(ProjectFolder::new(found.location));
        Ok(None)
    }

    /// Stops following a folder of the project `id`; the folder is left as it is. The project
    /// stays, with its notes, even without folders.
    pub fn remove_folder(&mut self, id: &str, folder: &str) -> anyhow::Result<()> {
        let project = self.project_mut(id)?;
        let index = project
            .folders
            .iter()
            .position(|f| f.id == folder)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))?;
        project.folders.remove(index);
        Ok(())
    }

    /// What a folder found at `path`, picked for a new project, is: another project's, or one to
    /// follow, with `inside`, the repositories right inside it, and whose each is.
    pub fn folder_choice(
        &self,
        path: String,
        found: FoundFolder,
        inside: Vec<FoundFolder>,
        case: NameCase,
    ) -> FolderChoice {
        if let Some(other) = self.at(&found.location, case) {
            return FolderChoice::InProject {
                id: other.id.clone(),
                name: other.name.clone(),
            };
        }
        let repositories = inside
            .into_iter()
            .filter_map(|repository| {
                let path = Path::new(&path).join(&repository.name).into_os_string();
                Some(FolderInside {
                    path: path.into_string().ok()?,
                    in_project: self.at(&repository.location, case).map(|p| p.name.clone()),
                    name: repository.name,
                    location: repository.location,
                })
            })
            .collect();
        FolderChoice::Usable {
            path,
            name: found.name,
            location: found.location,
            repositories,
        }
    }

    /// Whether `path`, on this machine, is inside a local project's folder, compared as the file
    /// system does (`case`). `canonical` names a path as the file system does (links resolved).
    pub fn holds(&self, path: &Path, canonical: impl Fn(&Path) -> PathBuf, case: NameCase) -> bool {
        let parts = |path: &Path| local_parts(&canonical(path), case);
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

    /// A project's folder `folder` found again at `found` (it moved): the project follows it
    /// there, and the folder keeps its id; the project its name, notes and layout. When `found`
    /// is another project's folder, nothing changes and that project comes back: a folder is one
    /// project's. Refused when `found` is on another machine or overlaps another of its folders.
    pub fn relocate(
        &mut self,
        folder: &str,
        found: FoundFolder,
        case: NameCase,
    ) -> anyhow::Result<Option<Project>> {
        let (project, _) = self.folder(folder)?;
        let id = project.id.clone();
        if let Some(other) = self.at(&found.location, case).filter(|p| p.id != id) {
            return Ok(Some(other.clone()));
        }
        let others = project.folders.iter().filter(|f| f.id != folder);
        checked_beside(&found.location, others.map(|f| &f.location), case)?;
        if let Some(moved) = self
            .project_mut(&id)?
            .folders
            .iter_mut()
            .find(|f| f.id == folder)
        {
            moved.location = found.location;
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::super::list::tests::*;
    use super::*;

    #[test]
    fn a_folder_removed_leaves_its_project() {
        let mut projects = ProjectList::default();
        let shop = projects
            .add(
                "Shop",
                vec![found("/api").location, found("/web").location],
                CASE,
            )
            .unwrap();
        let web = &shop.folders[1].id;
        projects.remove_folder(&shop.id, web).unwrap();
        assert_eq!(projects.projects[0].folders.len(), 1);
        assert!(projects.remove_folder(&shop.id, web).is_err());
        assert!(projects.remove_folder("elsewhere", web).is_err());
    }

    #[test]
    fn a_folder_added_goes_last_and_another_project_s_is_not_taken() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        assert_eq!(projects.add_folder("/a", found("/c"), CASE).unwrap(), None);
        assert_eq!(projects.projects[0].folders.len(), 2);
        assert_eq!(projects.projects[0].folders[1].location.root(), "/c");
        let other = projects.add_folder("/a", found("/b"), CASE).unwrap();
        assert_eq!(other.map(|p| p.id), Some("/b".into()));
        assert_eq!(
            code(projects.add_folder("/a", found("/c/d"), CASE).unwrap_err()),
            Some("folder_overlaps")
        );
        assert_eq!(
            code(projects.add_folder("/a", found("/"), CASE).unwrap_err()),
            Some("folder_overlaps")
        );
        assert_eq!(
            code(
                projects
                    .add_folder(
                        "/a",
                        FoundFolder {
                            name: "w".into(),
                            location: wsl("/w")
                        },
                        CASE
                    )
                    .unwrap_err()
            ),
            Some("folder_elsewhere")
        );
        // the project's own folder again: already there
        assert_eq!(
            code(projects.add_folder("/a", found("/a"), CASE).unwrap_err()),
            Some("folder_overlaps")
        );
        assert_eq!(projects.projects[0].folders.len(), 2);
    }

    #[test]
    fn a_folder_picked_is_another_projects_or_one_to_follow() {
        let projects = list(&["/a"], Some("/a"));
        let usable = projects.folder_choice("/api/src".into(), found("/api"), vec![], CASE);
        assert_eq!(
            usable,
            FolderChoice::Usable {
                path: "/api/src".into(),
                name: "api".into(),
                location: found("/api").location,
                repositories: vec![],
            }
        );
        let taken = projects.folder_choice("/a/src".into(), found("/a/"), vec![], CASE);
        assert_eq!(
            taken,
            FolderChoice::InProject {
                id: "/a".into(),
                name: "a".into()
            }
        );
    }

    #[test]
    fn a_parent_picked_tells_the_repositories_inside_and_whose_they_are() {
        let projects = list(&["/shop/api"], Some("/shop/api"));
        let repository = |name: &str| FoundFolder {
            name: name.into(),
            location: Location::Local {
                root: format!("/shop/{name}"),
            },
        };
        let inside = vec![repository("api"), repository("web")];
        let FolderChoice::Usable { repositories, .. } =
            projects.folder_choice("/shop".into(), found("/shop"), inside, CASE)
        else {
            panic!("a folder of no project");
        };
        let inside = |name: &str, project: Option<&str>| FolderInside {
            path: Path::new("/shop").join(name).to_string_lossy().into_owned(),
            name: name.into(),
            location: repository(name).location,
            in_project: project.map(String::from),
        };
        assert_eq!(
            repositories,
            [inside("api", Some("shop/api")), inside("web", None)]
        );
    }

    #[test]
    fn a_path_inside_a_repository_is_found_however_it_is_written() {
        let projects = list(&["/Dev/Shop"], Some("/Dev/Shop"));
        let same = |path: &Path| path.to_path_buf();
        assert!(projects.holds(Path::new("/Dev/Shop/notes.md"), same, NameCase::Kept));
        assert!(!projects.holds(Path::new("/Dev/Shopping/notes.md"), same, NameCase::Kept));
        assert!(!projects.holds(Path::new("/dev/shop/notes.md"), same, NameCase::Kept));
        assert!(projects.holds(Path::new("/dev/shop/notes.md"), same, NameCase::Ignored));
        // a link to the repository, as the file system resolves it
        let resolved =
            |path: &Path| PathBuf::from(path.to_string_lossy().replace("/link", "/Dev/Shop"));
        assert!(projects.holds(Path::new("/link/notes.md"), resolved, NameCase::Kept));
    }

    #[test]
    fn a_wsl_project_holds_no_path_of_this_machine() {
        let mut projects = list(&[], None);
        projects.open_folder(
            FoundFolder {
                name: "shop".into(),
                location: Location::Wsl {
                    distro: "Ubuntu".into(),
                    root: "/home/ale/shop".into(),
                },
            },
            CASE,
        );
        let same = |path: &Path| path.to_path_buf();
        assert!(!projects.holds(Path::new("/home/ale/shop/notes.md"), same, NameCase::Kept));
        assert!(projects.holds_in_wsl("Ubuntu", "/home/ale/shop/notes.md"));
        assert!(projects.holds_in_wsl("ubuntu", "/home/ale/shop"));
        assert!(!projects.holds_in_wsl("Ubuntu", "/home/ale/shopping/notes.md"));
        assert!(!projects.holds_in_wsl("Debian", "/home/ale/shop/notes.md"));
    }

    #[test]
    fn a_project_found_elsewhere_keeps_its_id_name_place_and_layout() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        projects.set_layout("/a", layout(0.3)).unwrap();
        assert_eq!(
            projects.relocate("/a", found("/moved"), CASE).unwrap(),
            None
        );
        assert_eq!(roots(&projects), ["/moved", "/b"]);
        let moved = &projects.projects[0];
        assert_eq!((moved.id.as_str(), moved.name.as_str()), ("/a", "a"));
        assert_eq!(projects.active.as_deref(), Some("/a"));
        assert_eq!(projects.layouts["/a"].split, 0.3);
    }

    #[test]
    fn a_folder_of_another_project_is_not_taken() {
        let mut projects = list(&["/a", "/b"], Some("/a"));
        let other = projects.relocate("/a", found("/b"), CASE).unwrap();
        assert_eq!(other.map(|p| p.id), Some("/b".into()));
        assert_eq!(projects, list(&["/a", "/b"], Some("/a")));
        assert_eq!(projects.relocate("/a", found("/a"), CASE).unwrap(), None);
        assert!(projects.relocate("/gone", found("/c"), CASE).is_err());
    }

    #[test]
    fn a_folder_relocated_keeps_its_id_beside_the_others() {
        let mut projects = ProjectList::default();
        let shop = projects
            .add(
                "Shop",
                vec![found("/api").location, found("/web").location],
                CASE,
            )
            .unwrap();
        let web = &shop.folders[1].id;
        assert_eq!(projects.relocate(web, found("/moved"), CASE).unwrap(), None);
        let folders = &projects.projects[0].folders;
        assert_eq!(
            (folders[1].id.as_str(), folders[1].location.root()),
            (web.as_str(), "/moved")
        );
        assert_eq!(
            code(projects.relocate(web, found("/api/web"), CASE).unwrap_err()),
            Some("folder_overlaps")
        );
    }
}
