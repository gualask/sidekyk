//! Concrete integrations: the git CLI, the filesystem watcher, persisted settings, notes' files, logs, the
//! system's own keyboard shortcuts.

pub(crate) mod git_cli;
pub(crate) mod logging;
pub(crate) mod notes_files;
pub(crate) mod settings_store;
#[cfg(target_os = "macos")]
pub(crate) mod system_shortcuts;
pub(crate) mod watcher;
