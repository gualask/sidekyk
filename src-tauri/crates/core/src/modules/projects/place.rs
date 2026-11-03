//! Where a project's folders are: a folder found on a machine, and places compared as the machine
//! holding them names them.

use std::path::Path;

use super::contracts::Location;
use crate::modules::repository::RepositoryInfo;

/// Whether this machine's file system tells names apart without case, as macOS and Windows do by
/// default.
pub const IGNORE_CASE: bool = cfg!(any(target_os = "macos", windows));

/// A folder found on a machine, a repository's root, and the name it suggests for a project.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FoundFolder {
    pub name: String,
    pub location: Location,
}

impl FoundFolder {
    /// A repository of this machine, as found there.
    pub fn local(found: RepositoryInfo) -> Self {
        Self {
            name: found.name,
            location: Location::Local { root: found.root },
        }
    }
}

impl Location {
    /// Whether `other` is the same folder: a local root compared as this machine's file system
    /// does, a WSL one in its distro.
    pub fn same_place(&self, other: &Location) -> bool {
        self.same_place_as(other, IGNORE_CASE)
    }

    /// Another folder of the same machine, at `root` as that machine names it.
    pub fn with_root(&self, root: String) -> Location {
        match self {
            Self::Local { .. } => Self::Local { root },
            Self::Wsl { distro, .. } => Self::Wsl {
                distro: distro.clone(),
                root,
            },
        }
    }

    /// Whether `other` is on the same machine: this one, or the same WSL distro.
    pub fn same_machine(&self, other: &Location) -> bool {
        match (self, other) {
            (Self::Local { .. }, Self::Local { .. }) => true,
            (Self::Wsl { distro: a, .. }, Self::Wsl { distro: b, .. }) => same_distro(a, b),
            _ => false,
        }
    }

    /// Whether one of the two folders is the other or inside it, on one machine.
    pub fn overlaps(&self, other: &Location) -> bool {
        self.overlaps_as(other, IGNORE_CASE)
    }

    fn same_place_as(&self, other: &Location, ignore_case: bool) -> bool {
        self.same_machine(other) && self.parts(ignore_case) == other.parts(ignore_case)
    }

    fn overlaps_as(&self, other: &Location, ignore_case: bool) -> bool {
        if !self.same_machine(other) {
            return false;
        }
        let (a, b) = (self.parts(ignore_case), other.parts(ignore_case));
        a.starts_with(&b) || b.starts_with(&a)
    }

    /// The root in parts, as the machine holding it compares names.
    fn parts(&self, ignore_case: bool) -> Vec<String> {
        match self {
            Self::Local { root } => local_parts(Path::new(root), ignore_case),
            Self::Wsl { root, .. } => linux_parts(root),
        }
    }
}

/// Whether two names are one WSL distro: WSL names them without case.
pub fn same_distro(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// A path of this machine in parts, its letters folded when the file system ignores case.
pub(super) fn local_parts(path: &Path, ignore_case: bool) -> Vec<String> {
    path.components()
        .map(|part| {
            let part = part.as_os_str().to_string_lossy();
            if ignore_case {
                part.to_lowercase()
            } else {
                part.into_owned()
            }
        })
        .collect()
}

/// A Linux path, in a WSL distro, in parts: Linux tells names apart by case.
pub(super) fn linux_parts(path: &str) -> Vec<String> {
    path.split('/')
        .filter(|part| !part.is_empty())
        .map(String::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(root: &str) -> Location {
        Location::Local { root: root.into() }
    }

    fn wsl(distro: &str, root: &str) -> Location {
        Location::Wsl {
            distro: distro.into(),
            root: root.into(),
        }
    }

    #[test]
    fn the_same_place_is_told_however_it_is_written() {
        assert!(local("/Dev/shop").same_place_as(&local("/Dev/shop/"), false));
        assert!(!local("/Dev/shop").same_place_as(&local("/dev/shop"), false));
        assert!(local("/Dev/shop").same_place_as(&local("/dev/shop"), true));
        assert!(!local("/Dev/shop").same_place_as(&local("/Dev/shopping"), true));
        assert!(wsl("Ubuntu", "/s").same_place_as(&wsl("ubuntu", "/s/"), false));
        assert!(!wsl("Ubuntu", "/s").same_place_as(&wsl("Ubuntu", "/S"), true));
        assert!(!wsl("Ubuntu", "/s").same_place_as(&wsl("Debian", "/s"), true));
        assert!(!local("/s").same_place_as(&wsl("Ubuntu", "/s"), true));
    }

    #[test]
    fn folders_overlap_when_one_holds_the_other_on_one_machine() {
        assert!(local("/Dev/shop").overlaps_as(&local("/Dev/shop/api"), false));
        assert!(local("/Dev/shop/api").overlaps_as(&local("/dev/shop"), true));
        assert!(local("/Dev/shop").overlaps_as(&local("/Dev/shop/"), false));
        assert!(!local("/Dev/shop/api").overlaps_as(&local("/Dev/shop/web"), true));
        assert!(!local("/Dev/shop").overlaps_as(&local("/Dev/shopping"), true));
        assert!(wsl("Ubuntu", "/s").overlaps_as(&wsl("ubuntu", "/s/api"), false));
        assert!(!wsl("Ubuntu", "/s").overlaps_as(&wsl("Debian", "/s/api"), false));
        assert!(!local("/s").overlaps_as(&wsl("Ubuntu", "/s/api"), false));
    }

    #[test]
    fn another_root_stays_on_its_machine() {
        assert_eq!(local("/a").with_root("/b".into()), local("/b"));
        assert_eq!(
            wsl("Ubuntu", "/a").with_root("/b".into()),
            wsl("Ubuntu", "/b")
        );
    }

    #[test]
    fn a_machine_is_this_one_or_one_distro() {
        assert!(local("/a").same_machine(&local("/b")));
        assert!(wsl("Ubuntu", "/a").same_machine(&wsl("ubuntu", "/b")));
        assert!(!wsl("Ubuntu", "/a").same_machine(&wsl("Debian", "/a")));
        assert!(!local("/a").same_machine(&wsl("Ubuntu", "/a")));
    }
}
