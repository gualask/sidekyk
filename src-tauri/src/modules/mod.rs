//! Workflow-owned behavior. Modules know nothing about Tauri; they reach the outside world only
//! through the ports they declare.

pub(crate) mod projects;
pub(crate) mod repository;
pub(crate) mod settings;
