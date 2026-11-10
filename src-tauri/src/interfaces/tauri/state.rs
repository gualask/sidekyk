//! What a folder given on the command line opened, kept until the page takes it.

use std::sync::Mutex;

use sidekyk_core::modules::projects::Opened;
use sidekyk_core::shared::sync::lock;

/// What a folder given on the command line did, until the frontend takes it: a project to show
/// its panels (the app starts at all projects otherwise), or a folder to ask about.
#[derive(Default)]
pub(crate) struct Launch {
    opened: Mutex<Option<Opened>>,
}

impl Launch {
    /// Keeps what a folder given on the command line did, for `take_opened`.
    pub(crate) fn set_opened(&self, opened: Opened) {
        *lock(&self.opened) = Some(opened);
    }

    /// What a folder given on the command line did, once: the frontend shows it, then it is
    /// forgotten.
    pub(crate) fn take_opened(&self) -> Option<Opened> {
        lock(&self.opened).take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_project_opened_is_taken_once() {
        let state = Launch::default();
        assert_eq!(state.take_opened(), None);
        let opened = Opened::Project {
            id: "0123456789abcdef".into(),
            folder_id: "0123456789abcdef".into(),
        };
        state.set_opened(opened.clone());
        assert_eq!(state.take_opened(), Some(opened));
        assert_eq!(state.take_opened(), None);
    }
}
