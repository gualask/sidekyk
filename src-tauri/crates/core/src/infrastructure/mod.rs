//! What runs on the machine holding the repository: the git CLI, the filesystem watcher, and the
//! helper that serves them to the app from another machine.

pub mod agent;
pub mod git_cli;
pub mod linux_helper;
pub mod machines;
mod process;
pub mod watcher;
pub mod wsl;

use std::process::Command;

/// Keeps a child process from opening a console window, which a GUI app's child does on Windows.
#[cfg(windows)]
pub(crate) fn hide_console(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::os::windows::process::CommandExt::creation_flags(command, CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_console(_: &mut Command) {}
