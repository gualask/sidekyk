//! The kinds of machine a project's folder can be on, each an adapter of `app::machines::Machine`:
//! this one, and WSL distros through the helper installed there (`linux_helper`).

pub mod linux_helper;
pub mod local;
pub mod wsl;
mod wsl_exe;
