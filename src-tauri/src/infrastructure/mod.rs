//! The app's own integrations: persisted settings, notes' files, logs, the system's own keyboard
//! shortcuts. Git and the watcher are the core's (`sidekyk_core::infrastructure`).

pub(crate) mod logging;
pub(crate) mod notes_files;
pub(crate) mod settings_store;
#[cfg(target_os = "macos")]
pub(crate) mod system_shortcuts;
