//! The app's own integrations and everything that differs by system: persisted settings, notes'
//! files, logs, the tray, the global shortcuts, capture, the window as each system shows it. Git,
//! the watcher and the machines are the core's (`sidekyk_core::infrastructure`).

pub(crate) mod capture;
pub(crate) mod files;
pub(crate) mod global_shortcuts;
pub(crate) mod logging;
pub(crate) mod notes_files;
pub(crate) mod settings_store;
pub(crate) mod stored_json;
pub(crate) mod tray;
pub(crate) mod window;
