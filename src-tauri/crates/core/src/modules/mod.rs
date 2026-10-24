//! Workflow-owned behavior. Modules know nothing about Tauri; they reach the outside world only
//! through the ports they declare.

pub mod folder;
pub mod notes;
pub mod projects;
pub mod repositories;
pub mod repository;
pub mod search;
pub mod settings;
pub mod syntax;
