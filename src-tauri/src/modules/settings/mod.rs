//! The user's settings: what they hold and their defaults. Storing and applying them belong to
//! the layers around it.

mod contracts;
#[cfg(target_os = "macos")]
mod shortcut;

#[cfg(any(target_os = "macos", windows))]
pub(crate) use contracts::ShortcutRefusal;
pub(crate) use contracts::{GlobalShortcut, GlobalShortcutStatus, Settings, Theme};
#[cfg(target_os = "macos")]
pub(crate) use shortcut::macos_allows;
