//! Linux registers no global shortcut: the desktop's own runs the app with a flag, which shows or
//! hides its window as the shortcut would. Capture and the quick note are not built here yet.

use tauri::{AppHandle, Manager};

use super::OnPress;
use sidekyk_core::modules::settings::{GlobalShortcutStatus, GlobalShortcutStatuses, Settings};

/// The command to give the desktop's shortcut.
struct ToggleCommand(String);

/// Keeps the command, this executable with `toggle_flag`: nothing registers.
pub(crate) fn start(app: &AppHandle, _settings: &Settings, _on_press: OnPress, toggle_flag: &str) {
    app.manage(ToggleCommand(toggle_command(toggle_flag)));
}

/// New settings only need storing.
pub(crate) fn apply(_app: &AppHandle, _settings: &Settings) -> anyhow::Result<()> {
    Ok(())
}

pub(crate) fn status(app: &AppHandle) -> GlobalShortcutStatuses {
    GlobalShortcutStatuses {
        toggle: GlobalShortcutStatus::Command {
            command: app.state::<ToggleCommand>().0.clone(),
        },
        capture: None,
        note: None,
    }
}

/// No shortcut is registered that typing a new one could press.
pub(crate) fn set_recording(_app: &AppHandle, _recording: bool) {}

/// This executable (the AppImage, for one) with the flag, quoted when its path has spaces.
fn toggle_command(flag: &str) -> String {
    let executable = std::env::var_os("APPIMAGE")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sidekyk".to_string());
    if executable.contains(' ') {
        format!("\"{executable}\" {flag}")
    } else {
        format!("{executable} {flag}")
    }
}
