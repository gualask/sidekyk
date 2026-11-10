//! This machine: its folders read by one `Repositories`, in this process or through the helper.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::app::machines::{Machine, MachineReader};
use crate::modules::projects::{FoundFolder, Location, NameCase, ProjectList};
use crate::modules::reader::Repositories;

/// How this machine's file system compares names: macOS and Windows ignore case by default.
const NAME_CASE: NameCase = if cfg!(any(target_os = "macos", windows)) {
    NameCase::Ignored
} else {
    NameCase::Kept
};

pub struct LocalMachine {
    reader: Arc<dyn Repositories>,
}

impl LocalMachine {
    pub fn new(reader: Arc<dyn Repositories>) -> Self {
        Self { reader }
    }
}

/// A path as the file system names it, links resolved; a file not written yet, by its folder; as
/// given when neither exists.
fn resolved_path(path: &Path) -> PathBuf {
    if let Ok(resolved) = fs::canonicalize(path) {
        return resolved;
    }
    match (path.parent(), path.file_name()) {
        (Some(folder), Some(name)) => fs::canonicalize(folder)
            .map(|folder| folder.join(name))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

fn is_local(location: &Location) -> bool {
    matches!(location, Location::Local { .. })
}

impl Machine for LocalMachine {
    fn holds(&self, location: &Location) -> bool {
        is_local(location)
    }

    fn reader(&self, _: &Location) -> Arc<dyn Repositories> {
        self.reader.clone()
    }

    fn readable_without_starting(&self, _: &Location) -> anyhow::Result<()> {
        Ok(())
    }

    fn readers(&self) -> Vec<MachineReader> {
        vec![MachineReader {
            reader: self.reader.clone(),
            holds: Box::new(is_local),
        }]
    }

    fn folder_at(&self, path: &Path) -> Option<anyhow::Result<FoundFolder>> {
        Some(self.reader.resolve(path).map(FoundFolder::local))
    }

    fn host_path(&self, _: &Location, path: &Path) -> anyhow::Result<String> {
        Ok(path.to_string_lossy().into_owned())
    }

    /// Any path not another machine's is this one's.
    fn holds_host_path(&self, list: &ProjectList, path: &Path) -> Option<bool> {
        Some(list.holds(path, resolved_path, NAME_CASE))
    }

    fn set_visible(&self, visible: bool) -> Option<Location> {
        let root = self.reader.set_visible(visible)?;
        Some(Location::Local { root })
    }

    fn name_case(&self) -> NameCase {
        NAME_CASE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_resolves_through_links_and_a_file_not_written_by_its_folder() {
        let data = tempfile::tempdir().unwrap();
        let real = resolved_path(data.path());
        let missing = resolved_path(&data.path().join("notes.md"));
        assert_eq!(missing, real.join("notes.md"));
        #[cfg(unix)]
        {
            let link = data.path().join("link");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            assert_eq!(resolved_path(&link.join("notes.md")), real.join("notes.md"));
        }
    }
}
