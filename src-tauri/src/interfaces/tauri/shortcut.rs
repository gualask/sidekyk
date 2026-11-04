//! Tauri adapter for the global shortcuts, from any app: the one that shows and hides the window
//! and, where they are built, the one that captures an area of the screen and the one that opens
//! a quick note. macOS and Windows
//! register them through `tauri-plugin-global-shortcut`, which costs nothing until one is pressed
//! (`modules/settings` decides which keys and where each stands). Linux registers none: the
//! desktop's own shortcut runs `sidekyk --toggle`.

use tauri::AppHandle;

use sidekyk_core::modules::settings::GlobalShortcutStatuses;

/// `sidekyk --toggle`, run while Sidekyk runs, shows or hides its window like the shortcut.
pub(crate) const TOGGLE_FLAG: &str = "--toggle";

#[tauri::command]
/// Where each global shortcut stands, from memory. Async, so off the main thread: a change of
/// the settings holds the state while the main thread registers its shortcut.
pub(crate) async fn get_global_shortcut_status(app: AppHandle) -> GlobalShortcutStatuses {
    platform::status(&app)
}

#[tauri::command]
/// A new shortcut is being typed in the settings, or no longer is.
pub(crate) fn set_shortcut_recording(app: AppHandle, recording: bool) {
    platform::set_recording(&app, recording);
}

pub(crate) use platform::{apply, set_recording, start};

#[cfg(any(target_os = "macos", windows))]
mod platform {
    use std::sync::atomic::{AtomicU64, Ordering};

    use tauri::{AppHandle, Manager};
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    use crate::infrastructure::capture as system_capture;
    use crate::infrastructure::window::QUICK_NOTE_BUILT;
    use crate::interfaces::tauri::capture::capture;
    use crate::interfaces::tauri::quick_note;
    use crate::interfaces::tauri::window::toggle_main_window;
    use sidekyk_core::modules::settings::{
        GlobalShortcutStatuses, GlobalShortcuts, RegisterError, Settings, ShortcutAction,
        ShortcutKeys, ShortcutRegistrar,
    };

    /// The plugin's ids of the capture and quick note shortcuts registered, `NONE` without one: a
    /// press of any other is the window's. Apart from `GlobalShortcuts`' state, which a press
    /// must not wait for.
    struct PressIds {
        capture: AtomicU64,
        note: AtomicU64,
    }

    impl PressIds {
        /// The id kept for a shortcut's presses; none for the window's, the one left.
        fn of(&self, action: ShortcutAction) -> Option<&AtomicU64> {
            match action {
                ShortcutAction::Toggle => None,
                ShortcutAction::Capture => Some(&self.capture),
                ShortcutAction::Note => Some(&self.note),
            }
        }
    }

    const NONE: u64 = u64::MAX;

    /// The shortcuts built here beside the window's.
    fn built() -> Vec<ShortcutAction> {
        let mut built = Vec::new();
        if system_capture::BUILT {
            built.push(ShortcutAction::Capture);
        }
        if QUICK_NOTE_BUILT {
            built.push(ShortcutAction::Note);
        }
        built
    }

    /// The system's global shortcuts, through the plugin.
    struct PluginRegistrar<'a>(&'a AppHandle);

    impl ShortcutRegistrar for PluginRegistrar<'_> {
        fn register(
            &self,
            action: ShortcutAction,
            keys: &ShortcutKeys,
        ) -> Result<(), RegisterError> {
            let shortcut = plugin_shortcut(keys)?;
            self.0
                .global_shortcut()
                .register(shortcut)
                .map_err(|error| {
                    tracing::debug!(%error, keys = keys.as_str(), "global shortcut refused");
                    RegisterError::Taken
                })?;
            if let Some(id) = self.0.state::<PressIds>().of(action) {
                id.store(u64::from(shortcut.id()), Ordering::Relaxed);
            }
            Ok(())
        }

        fn unregister(&self, action: ShortcutAction, keys: &ShortcutKeys) {
            let Ok(shortcut) = plugin_shortcut(keys) else {
                return;
            };
            if let Some(id) = self.0.state::<PressIds>().of(action) {
                // a new shortcut registers before the old one goes
                let _ = id.compare_exchange(
                    u64::from(shortcut.id()),
                    NONE,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
            }
            if let Err(error) = self.0.global_shortcut().unregister(shortcut) {
                tracing::warn!(%error, "could not release a global shortcut");
            }
        }

        #[cfg(target_os = "macos")]
        fn system_uses(&self, keys: &ShortcutKeys) -> bool {
            crate::infrastructure::system_shortcuts::system_uses(keys)
        }

        /// Windows refuses a shortcut another app or the system holds: one registered is free.
        #[cfg(windows)]
        fn system_uses(&self, _keys: &ShortcutKeys) -> bool {
            false
        }
    }

    fn plugin_shortcut(keys: &ShortcutKeys) -> Result<Shortcut, RegisterError> {
        keys.as_str()
            .parse()
            .map_err(|_| RegisterError::Unsupported)
    }

    /// Starts the plugin and registers the stored shortcuts.
    pub(crate) fn start(app: &AppHandle, settings: &Settings) {
        app.manage(GlobalShortcuts::new(&built()));
        app.manage(PressIds {
            capture: AtomicU64::new(NONE),
            note: AtomicU64::new(NONE),
        });
        let plugin = tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state != ShortcutState::Pressed
                    || !app.state::<GlobalShortcuts>().takes_press()
                {
                    return;
                }
                let id = u64::from(shortcut.id());
                let ids = app.state::<PressIds>();
                if id == ids.capture.load(Ordering::Relaxed) {
                    capture(app);
                } else if id == ids.note.load(Ordering::Relaxed) {
                    quick_note::toggle(app);
                } else {
                    toggle_main_window(app);
                }
            })
            .build();
        let shortcuts = app.state::<GlobalShortcuts>();
        match app.plugin(plugin) {
            Ok(()) => shortcuts.start(&PluginRegistrar(app), settings),
            Err(error) => {
                tracing::warn!(%error, "no global shortcut: the plugin did not start");
                shortcuts.unavailable();
            }
        }
    }

    /// Registers the shortcuts of new settings, before they are stored.
    pub(crate) fn apply(app: &AppHandle, settings: &Settings) -> anyhow::Result<()> {
        app.state::<GlobalShortcuts>()
            .apply(&PluginRegistrar(app), settings)
    }

    pub(super) fn status(app: &AppHandle) -> GlobalShortcutStatuses {
        app.state::<GlobalShortcuts>().status()
    }

    pub(crate) fn set_recording(app: &AppHandle, recording: bool) {
        app.state::<GlobalShortcuts>().set_recording(recording);
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use sidekyk_core::modules::settings::shortcut_keys::{KEYS, MODIFIERS};

        #[test]
        fn the_plugin_names_every_shortcut() {
            let all = MODIFIERS.join("+");
            for key in KEYS {
                for keys in [format!("Control+{key}"), format!("{all}+{key}")] {
                    let keys = ShortcutKeys::parse(&keys).unwrap();
                    assert!(plugin_shortcut(&keys).is_ok(), "{}", keys.as_str());
                }
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use tauri::AppHandle;

    use super::TOGGLE_FLAG;
    use sidekyk_core::modules::settings::{GlobalShortcutStatus, GlobalShortcutStatuses, Settings};

    /// Linux registers no shortcut: there is nothing to start.
    pub(crate) fn start(_app: &AppHandle, _settings: &Settings) {}

    /// Linux registers no shortcut: new settings only need storing.
    pub(crate) fn apply(_app: &AppHandle, _settings: &Settings) -> anyhow::Result<()> {
        Ok(())
    }

    /// The command to give the desktop's shortcut; capture and the quick note are not built here
    /// yet.
    pub(super) fn status(_app: &AppHandle) -> GlobalShortcutStatuses {
        GlobalShortcutStatuses {
            toggle: GlobalShortcutStatus::Command {
                command: toggle_command(),
            },
            capture: None,
            note: None,
        }
    }

    /// Linux registers no shortcut that typing a new one could press.
    pub(crate) fn set_recording(_app: &AppHandle, _recording: bool) {}

    /// This executable (the AppImage, for one) with the flag, quoted when its path has spaces.
    fn toggle_command() -> String {
        let executable = std::env::var_os("APPIMAGE")
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::current_exe().ok())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| "sidekyk".to_string());
        if executable.contains(' ') {
            format!("\"{executable}\" {TOGGLE_FLAG}")
        } else {
            format!("{executable} {TOGGLE_FLAG}")
        }
    }
}
