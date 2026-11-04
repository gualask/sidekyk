//! The user's settings: what they hold and their defaults, and the global shortcuts (the window's,
//! capture's, the quick note's). Storing them and reaching the system belong to the layers around
//! it.

mod contracts;
#[cfg(any(target_os = "macos", windows))]
mod global_shortcut;
#[cfg(any(target_os = "macos", windows))]
pub mod shortcut_keys;

pub use contracts::{
    GlobalShortcut, GlobalShortcutStatus, GlobalShortcutStatuses, Language, Settings, Theme,
};
#[cfg(any(target_os = "macos", windows))]
pub use global_shortcut::{GlobalShortcuts, RegisterError, ShortcutAction, ShortcutRegistrar};
#[cfg(any(target_os = "macos", windows))]
pub use shortcut_keys::ShortcutKeys;
