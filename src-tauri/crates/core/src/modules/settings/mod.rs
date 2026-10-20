//! The user's settings: what they hold and their defaults, and the global shortcut that shows and
//! hides the window. Storing them and reaching the system belong to the layers around it.

mod contracts;
#[cfg(any(target_os = "macos", windows))]
mod global_shortcut;
#[cfg(any(target_os = "macos", windows))]
pub mod shortcut_keys;

pub use contracts::{GlobalShortcut, GlobalShortcutStatus, Language, Settings, Theme};
#[cfg(any(target_os = "macos", windows))]
pub use global_shortcut::{GlobalShortcuts, RegisterError, ShortcutRegistrar};
#[cfg(any(target_os = "macos", windows))]
pub use shortcut_keys::ShortcutKeys;
