//! Tauri command adapters.
//!
//! Every public command name remains in this module tree. Adapters validate transport-specific
//! inputs, move blocking work off the async runtime, and delegate one operation to its owning
//! module.

mod blocking;
pub(crate) mod diagnostics;
pub(crate) mod projects;
pub(crate) mod repository;
pub(crate) mod search;
pub(crate) mod settings;
pub(crate) mod state;
pub(crate) mod window;
