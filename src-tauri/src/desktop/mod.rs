//! The window's session: what exists because of this window and the system it shows on. Its first
//! show, showing and hiding it, the compact window's stages, the capture going on and the areas
//! waiting, the settings in effect, the backend's texts, what a launch opened. The entry points
//! (commands, the tray, the shortcuts, the command line) reach it; it never reaches them.

pub(crate) mod capture;
mod compact_frame;
pub(crate) mod compact_window;
pub(crate) mod launch;
pub(crate) mod settings;
pub(crate) mod texts;
pub(crate) mod window;
