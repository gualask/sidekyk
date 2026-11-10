//! This machine: its folders read by one `Repositories`, in this process or through the helper.

use std::path::Path;
use std::sync::Arc;

use crate::app::machines::{Machine, MachineReader};
use crate::modules::projects::{FoundFolder, Location, NameCase};
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

    fn set_visible(&self, visible: bool) -> Option<Location> {
        let root = self.reader.set_visible(visible)?;
        Some(Location::Local { root })
    }

    fn name_case(&self) -> NameCase {
        NAME_CASE
    }
}
