//! The command line: `sidekyk <folder>` opens that folder's project, `sidekyk --toggle` shows or
//! hides the window as the global shortcut does, `sidekyk` alone shows it. Run again while Sidekyk
//! runs, the running app does it (single instance).

use std::path::PathBuf;

use tauri::AppHandle;

use crate::desktop::{launch, window};

/// `sidekyk --toggle`, run while Sidekyk runs, shows or hides its window like the shortcut.
pub(crate) const TOGGLE_FLAG: &str = "--toggle";

/// The first argument that is not a flag: `sidekyk ~/Dev/project` opens that repository.
fn folder_argument(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(PathBuf::from)
}

/// The app starts: a folder named opens, once the windows are there.
pub(crate) fn launched(app: &AppHandle) {
    let args: Vec<String> = std::env::args().collect();
    if let Some(folder) = folder_argument(&args) {
        launch::open(app, folder);
    }
}

/// Sidekyk run again while it runs, with these arguments, from `cwd`.
pub(crate) fn launched_again(app: &AppHandle, args: &[String], cwd: &str) {
    if let Some(folder) = folder_argument(args) {
        launch::open(app, PathBuf::from(cwd).join(folder));
        window::show(app);
    } else if args.iter().skip(1).any(|a| a == TOGGLE_FLAG) {
        window::toggle(app);
    } else {
        window::show(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_argument_skips_the_binary_and_flags() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            folder_argument(&args(&["sidekyk", "--flag", "proj"])),
            Some(PathBuf::from("proj"))
        );
        assert_eq!(folder_argument(&args(&["sidekyk"])), None);
    }
}
