//! Sidekyk without Tauri: the modules, the application service over them (`app`), the primitives
//! they build on, and the infrastructure of the machine holding the folder (git, the watcher), the
//! helper's protocol and the machines' adapters. The app runs all of it; the helper runs what
//! reads a folder (`reader`, `repository`, `search`, `syntax`).

pub mod app;
pub mod infrastructure;
pub mod modules;
pub mod shared;
