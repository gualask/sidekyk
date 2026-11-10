//! The user's settings: what they hold and their defaults, and the global shortcuts (the window's,
//! capture's, the quick note's). Storing them and reaching the system belong to the layers around
//! it.

mod contracts;
mod global_shortcut;
pub mod shortcut_keys;

pub use contracts::{
    GlobalShortcut, GlobalShortcutStatus, GlobalShortcutStatuses, Language, Settings, Theme,
};
pub use global_shortcut::{GlobalShortcuts, RegisterError, ShortcutAction, ShortcutRegistrar};
pub use shortcut_keys::ShortcutKeys;
