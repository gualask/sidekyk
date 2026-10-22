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

    fn same_place_as(&self, other: &Location, ignore_case: bool) -> bool {
        match (self, other) {
            (Self::Local { root: a }, Self::Local { root: b }) => {
                local_parts(Path::new(a), ignore_case) == local_parts(Path::new(b), ignore_case)
            }
            (
                Self::Wsl {
                    distro: a,
                    root: a_root,
                },
                Self::Wsl {
                    distro: b,
                    root: b_root,
                },
            ) => same_distro(a, b) && linux_parts(a_root) == linux_parts(b_root),
            _ => false,
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
}
