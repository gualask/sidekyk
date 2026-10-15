//! The global shortcut that shows and hides the window from any app. macOS and Windows register
//! it through `tauri-plugin-global-shortcut`, which costs nothing until it is pressed. Linux
//! registers none: the desktop's own shortcut runs `sidekyk --toggle` (see `bootstrap`).

use tauri::AppHandle;

use crate::modules::settings::GlobalShortcutStatus;

/// The shortcut registered and what the settings dialog says about it.
#[derive(Default)]
pub(crate) struct GlobalShortcutState {
    #[cfg(any(target_os = "macos", windows))]
    inner: std::sync::Mutex<registered::Inner>,
    /// A new shortcut is being typed in the settings: pressing the current one does nothing.
    #[cfg(any(target_os = "macos", windows))]
    recording: std::sync::atomic::AtomicBool,
}

#[tauri::command]
/// Where the global shortcut stands, from memory. Async, so off the main thread: a change of
/// the settings holds the state while the main thread registers its shortcut.
pub(crate) async fn get_global_shortcut_status(app: AppHandle) -> GlobalShortcutStatus {
    status(&app)
}

#[tauri::command]
/// A new shortcut is being typed in the settings, or no longer is.
pub(crate) fn set_shortcut_recording(app: AppHandle, recording: bool) {
    set_recording(&app, recording);
}

#[cfg(any(target_os = "macos", windows))]
mod registered {
    use std::sync::atomic::Ordering;

    use tauri::{AppHandle, Manager};
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    use super::GlobalShortcutState;
    use crate::interfaces::tauri::window::toggle_main_window;
    use crate::modules::settings::{GlobalShortcut, GlobalShortcutStatus, ShortcutRefusal};
    use crate::shared::error::{user_facing, UserFacingErrorCode};
    use crate::shared::sync::lock;

    /// The shortcut registered, and where it stands.
    #[derive(Default)]
    pub(super) struct Inner {
        pub(super) status: GlobalShortcutStatus,
        registered: Option<Shortcut>,
        available: bool,
    }

    /// Why a shortcut could not be registered.
    enum Failure {
        Invalid,
        Refused(ShortcutRefusal),
    }

    pub(super) fn status(app: &AppHandle) -> GlobalShortcutStatus {
        lock(&app.state::<GlobalShortcutState>().inner)
            .status
            .clone()
    }

    pub(super) fn set_recording(app: &AppHandle, recording: bool) {
        app.state::<GlobalShortcutState>()
            .recording
            .store(recording, Ordering::Relaxed);
    }

    /// Starts the plugin and registers the stored shortcut. A shortcut the system turns down
    /// leaves none, and says why to the top bar's problems.
    pub(crate) fn start(app: &AppHandle, settings: &GlobalShortcut) {
        let plugin = tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                let recording = app
                    .state::<GlobalShortcutState>()
                    .recording
                    .load(Ordering::Relaxed);
                if event.state == ShortcutState::Pressed && !recording {
                    toggle_main_window(app);
                }
            })
            .build();
        let state = app.state::<GlobalShortcutState>();
        let mut inner = lock(&state.inner);
        if let Err(error) = app.plugin(plugin) {
            tracing::warn!(%error, "no global shortcut: the plugin did not start");
            inner.status = GlobalShortcutStatus::Unavailable;
            return;
        }
        inner.available = true;
        match switch(app, &mut inner, settings) {
            Ok(()) => {}
            Err(Failure::Invalid) => {
                tracing::warn!(keys = %settings.keys, "the stored global shortcut is not one");
            }
            Err(Failure::Refused(reason)) => {
                tracing::warn!(keys = %settings.keys, ?reason, "the global shortcut was refused");
                inner.status = GlobalShortcutStatus::Refused {
                    keys: settings.keys.clone(),
                    reason,
                };
            }
        }
    }

    /// Registers the shortcut of new settings in place of the current one, before they are
    /// stored. A shortcut the system turns down leaves the current one, and fails.
    pub(crate) fn apply(app: &AppHandle, settings: &GlobalShortcut) -> anyhow::Result<()> {
        let state = app.state::<GlobalShortcutState>();
        let mut inner = lock(&state.inner);
        if !inner.available {
            return Ok(());
        }
        switch(app, &mut inner, settings).map_err(|failure| {
            user_facing(match failure {
                Failure::Invalid => UserFacingErrorCode::InvalidShortcut,
                Failure::Refused(ShortcutRefusal::Taken) => UserFacingErrorCode::ShortcutTaken,
                #[cfg(target_os = "macos")]
                Failure::Refused(ShortcutRefusal::NotAllowed) => {
                    UserFacingErrorCode::ShortcutNotAllowed
                }
            })
        })
    }

    /// Registers the new shortcut first, then lets the old one go, so a refusal keeps the old.
    fn switch(
        app: &AppHandle,
        inner: &mut Inner,
        settings: &GlobalShortcut,
    ) -> Result<(), Failure> {
        if !settings.enabled {
            release(app, inner);
            inner.status = GlobalShortcutStatus::Off;
            return Ok(());
        }
        let shortcut: Shortcut = settings.keys.parse().map_err(|_| Failure::Invalid)?;
        if inner.registered != Some(shortcut) {
            check_allowed(&settings.keys)?;
            app.global_shortcut().register(shortcut).map_err(|error| {
                tracing::debug!(%error, keys = %settings.keys, "global shortcut refused");
                Failure::Refused(ShortcutRefusal::Taken)
            })?;
            release(app, inner);
            inner.registered = Some(shortcut);
        }
        inner.status = GlobalShortcutStatus::Active {
            keys: settings.keys.clone(),
            conflict: system_uses(&settings.keys),
        };
        Ok(())
    }

    fn release(app: &AppHandle, inner: &mut Inner) {
        if let Some(old) = inner.registered.take() {
            if let Err(error) = app.global_shortcut().unregister(old) {
                tracing::warn!(%error, "could not release the global shortcut");
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn check_allowed(keys: &str) -> Result<(), Failure> {
        if crate::modules::settings::macos_allows(keys) {
            Ok(())
        } else {
            Err(Failure::Refused(ShortcutRefusal::NotAllowed))
        }
    }

    #[cfg(windows)]
    fn check_allowed(_keys: &str) -> Result<(), Failure> {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn system_uses(keys: &str) -> bool {
        crate::infrastructure::system_shortcuts::system_uses(keys)
    }

    /// Windows refuses a shortcut another app or the system holds: one registered is free.
    #[cfg(windows)]
    fn system_uses(_keys: &str) -> bool {
        false
    }
}

#[cfg(any(target_os = "macos", windows))]
pub(crate) use registered::apply;

#[cfg(any(target_os = "macos", windows))]
use registered::{set_recording, status};

/// Starts the global shortcut with the stored settings.
#[cfg(any(target_os = "macos", windows))]
pub(crate) use registered::start;

#[cfg(not(any(target_os = "macos", windows)))]
use crate::modules::settings::GlobalShortcut;

/// Linux registers no shortcut: there is nothing to start.
#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn start(_app: &AppHandle, _settings: &GlobalShortcut) {}

/// Linux registers no shortcut: new settings only need storing.
#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn apply(_app: &AppHandle, _settings: &GlobalShortcut) -> anyhow::Result<()> {
    Ok(())
}

/// Linux: the command to give the desktop's shortcut.
#[cfg(not(any(target_os = "macos", windows)))]
fn status(_app: &AppHandle) -> GlobalShortcutStatus {
    GlobalShortcutStatus::Command {
        command: toggle_command(),
    }
}

/// Linux registers no shortcut that typing a new one could press.
#[cfg(not(any(target_os = "macos", windows)))]
fn set_recording(_app: &AppHandle, _recording: bool) {}

/// The command the desktop's shortcut runs: this executable (the AppImage, for one) with
/// `--toggle`, quoted when its path has spaces.
#[cfg(not(any(target_os = "macos", windows)))]
fn toggle_command() -> String {
    let executable = std::env::var_os("APPIMAGE")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sidekyk".to_string());
    if executable.contains(' ') {
        format!("\"{executable}\" --toggle")
    } else {
        format!("{executable} --toggle")
    }
}
