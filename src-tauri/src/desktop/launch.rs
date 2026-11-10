//! A folder named at launch, or to the running app: added and shown, and what it opened kept until
//! the page takes it.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use sidekyk_core::app::projects::Projects;
use sidekyk_core::modules::projects::{Opened, ProjectsChangedEvent, PROJECTS_CHANGED_EVENT};
use sidekyk_core::shared::sync::lock;

/// What a folder given on the command line did, until the frontend takes it: a project to show
/// its panels (the app starts at all projects otherwise), or a folder to ask about.
#[derive(Default)]
pub(crate) struct Launch {
    opened: Mutex<Option<Opened>>,
}

impl Launch {
    /// Keeps what a folder given on the command line did, for `take_opened`.
    fn set_opened(&self, opened: Opened) {
        *lock(&self.opened) = Some(opened);
    }

    /// What a folder given on the command line did, once: the frontend shows it, then it is
    /// forgotten.
    fn take_opened(&self) -> Option<Opened> {
        lock(&self.opened).take()
    }
}

/// Adds and shows a folder named at launch, off the main thread: a WSL distro's may take a while
/// to start. What it opened is kept before the page is told the list changed, so the page finds
/// it; a failure leaves the app as it was.
pub(crate) fn open(app: &AppHandle, folder: PathBuf) {
    let app = app.clone();
    std::thread::spawn(move || match app.state::<Projects>().open_folder(&folder) {
        Ok(opened) => {
            app.state::<Launch>().set_opened(opened);
            let _ = app.emit(PROJECTS_CHANGED_EVENT, ProjectsChangedEvent::default());
        }
        Err(error) => tracing::warn!(
            folder = %folder.display(),
            error = %format!("{error:#}"),
            "could not open the folder"
        ),
    });
}

/// What a folder given on the command line did, once.
pub(crate) fn take_opened(app: &AppHandle) -> Option<Opened> {
    app.state::<Launch>().take_opened()
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
