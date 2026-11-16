//! The entry points: the commands and URI schemes the page calls, what the tray's items and the
//! global shortcuts do, the command line and the app's events. Each translates and delegates to
//! the core's `app`, `desktop/` or a Tauri plugin; none holds state but `blocking.rs`: its log of
//! failures and the ports `bootstrap` chose. No entry point imports another; what they share is in
//! the layer's helpers, none an entry point: `blocking.rs` (how a command reaches its work) and
//! `raw.rs` (what crosses without being JSON). A capability's entry points share a folder
//! (`notes/`, `projects/`), its URI scheme beside its commands.

pub(crate) mod blocking;
pub(crate) mod capture;
pub(crate) mod cli;
pub(crate) mod compact_window;
pub(crate) mod diagnostics;
pub(crate) mod diagram;
pub(crate) mod lifecycle;
pub(crate) mod links;
pub(crate) mod notes;
pub(crate) mod projects;
mod raw;
pub(crate) mod repository;
pub(crate) mod search;
pub(crate) mod settings;
pub(crate) mod shortcuts;
pub(crate) mod tray;
pub(crate) mod window;
