//! Tauri command adapters.
//!
//! Every public command name remains in this module tree. Adapters validate transport-specific
//! inputs, move blocking work off the async runtime, and delegate one operation to its owning
//! module.

pub(crate) mod diagnostics;
pub(crate) mod repository;
pub(crate) mod state;
