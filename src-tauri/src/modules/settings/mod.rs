//! The user's settings: what they hold and their defaults, and the global shortcut that shows and
//! hides the window. Storing them and reaching the system belong to the layers around it.

mod contracts;
#[cfg(any(target_os = "macos", windows))]
mod global_shortcut;
#[cfg(any(target_os = "macos", windows))]
pub(crate) mod shortcut_keys;

pub(crate) use contracts::{GlobalShortcut, GlobalShortcutStatus, Settings, Theme};
#[cfg(any(target_os = "macos", windows))]
pub(crate) use global_shortcut::{GlobalShortcuts, RegisterError, ShortcutRegistrar};
#[cfg(any(target_os = "macos", windows))]
pub(crate) use shortcut_keys::ShortcutKeys;
