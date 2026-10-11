//! Concrete integrations: the git CLI, the filesystem watcher, persisted settings, logs.

pub(crate) mod git_cli;
pub(crate) mod logging;
pub(crate) mod settings_store;
pub(crate) mod watcher;
