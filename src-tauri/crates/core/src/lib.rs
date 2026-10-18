//! Sidekyk without Tauri: the modules, the primitives they build on, and the infrastructure of the
//! machine holding the repository (git, the watcher), the helper's protocol and the WSL transport.
//! The app runs all of it; the helper runs what reads a repository (`repository`, `search`,
//! `syntax`).

pub mod infrastructure;
pub mod modules;
pub mod shared;
