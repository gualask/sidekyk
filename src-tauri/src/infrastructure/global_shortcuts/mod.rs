//! The global shortcuts, from any app: the one that shows and hides the window and, where they
//! are built, the one that captures an area of the screen and the one that opens a quick note.
//! macOS and Windows register them through `tauri-plugin-global-shortcut`, which costs nothing
//! until one is pressed (`modules/settings` decides which keys and where each stands); what a
//! press does is the caller's. Linux registers none: the desktop's own shortcut runs the app with
//! a flag, the command `status` gives.

#[cfg(not(any(target_os = "macos", windows)))]
mod command;
#[cfg(any(target_os = "macos", windows))]
mod plugin;
#[cfg(target_os = "macos")]
mod system_shortcuts;

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) use command::{apply, set_recording, start, status};
#[cfg(any(target_os = "macos", windows))]
pub(crate) use plugin::{apply, set_recording, start, status};

use sidekyk_core::modules::settings::ShortcutAction;

/// What a press of a shortcut does.
pub(crate) type OnPress = fn(&tauri::AppHandle, ShortcutAction);
