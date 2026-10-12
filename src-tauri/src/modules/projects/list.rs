use super::contracts::ProjectList;
use crate::modules::repository::RepositoryInfo;
use crate::shared::error::{user_facing, UserFacingErrorCode};

impl ProjectList {
    /// A stored list made consistent: no project twice, and an active project whenever there is
    /// one, so a file edited by hand cannot leave the app without a project on screen.
    pub(crate) fn normalized(mut self) -> Self {
        let mut seen = std::collections::HashSet::new();
        self.projects.retain(|p| seen.insert(p.root.clone()));
        if self.active().is_none() {
            self.active = self.projects.first().map(|p| p.root.clone());
        }
        self
    }

    pub(crate) fn find(&self, root: &str) -> anyhow::Result<&RepositoryInfo> {
        self.projects
            .iter()
            .find(|p| p.root == root)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))
    }

    pub(crate) fn active(&self) -> Option<&RepositoryInfo> {
        let root = self.active.as_deref()?;
        self.projects.iter().find(|p| p.root == root)
    }

    /// Adds the project at the end, unless it is already there, and puts it on screen.
    pub(crate) fn add(&mut self, project: RepositoryInfo) {
        if self.find(&project.root).is_err() {
            self.projects.push(project.clone());
        }
        self.active = Some(project.root);
    }

    pub(crate) fn activate(&mut self, root: &str) -> anyhow::Result<()> {
        self.find(root)?;
        self.active = Some(root.to_string());
        Ok(())
    }

    /// Forgets a project; its repository is left as it is. When it was on screen, the one after
    /// it takes its place, or the one before it when it was the last.
    pub(crate) fn remove(&mut self, root: &str) -> anyhow::Result<()> {
        let index = self
            .projects
            .iter()
            .position(|p| p.root == root)
            .ok_or_else(|| user_facing(UserFacingErrorCode::ProjectNotFound))?;
        self.projects.remove(index);
        if self.active.as_deref() == Some(root) {
            let next = self.projects.get(index).or(self.projects.last());
            self.active = next.map(|p| p.root.clone());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::error::user_facing_code;

    fn project(root: &str) -> RepositoryInfo {
        RepositoryInfo {
            root: root.into(),
            name: root.trim_start_matches('/').into(),
        }
    }

    fn list(roots: &[&str], active: Option<&str>) -> ProjectList {
        ProjectList {
            projects: roots.iter().map(|r| project(r)).collect(),
            active: active.map(String::from),
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
        assert_eq!(projects.active().map(|p| p.root.as_str()), Some("/b"));

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
}
