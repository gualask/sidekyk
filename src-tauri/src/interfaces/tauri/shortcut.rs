//! Tauri adapter for the global shortcut that shows and hides the window from any app. macOS and
//! Windows register it through `tauri-plugin-global-shortcut`, which costs nothing until it is
//! pressed (`modules/settings` decides which one and where it stands). Linux registers none: the
//! desktop's own shortcut runs `sidekyk --toggle`.

use tauri::AppHandle;

use sidekyk_core::modules::settings::GlobalShortcutStatus;

/// `sidekyk --toggle`, run while Sidekyk runs, shows or hides its window like the shortcut.
pub(crate) const TOGGLE_FLAG: &str = "--toggle";

#[tauri::command]
/// Where the global shortcut stands, from memory. Async, so off the main thread: a change of
/// the settings holds the state while the main thread registers its shortcut.
pub(crate) async fn get_global_shortcut_status(app: AppHandle) -> GlobalShortcutStatus {
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
    use tauri::{AppHandle, Manager};
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    use crate::interfaces::tauri::window::toggle_main_window;
    use sidekyk_core::modules::settings::{
        GlobalShortcut, GlobalShortcutStatus, GlobalShortcuts, RegisterError, ShortcutKeys,
        ShortcutRegistrar,
    };

    /// The system's global shortcuts, through the plugin.
    struct PluginRegistrar<'a>(&'a AppHandle);

    impl ShortcutRegistrar for PluginRegistrar<'_> {
        fn register(&self, keys: &ShortcutKeys) -> Result<(), RegisterError> {
            let shortcut = plugin_shortcut(keys)?;
            self.0
                .global_shortcut()
                .register(shortcut)
                .map_err(|error| {
                    tracing::debug!(%error, keys = keys.as_str(), "global shortcut refused");
                    RegisterError::Taken
                })
        }

        fn unregister(&self, keys: &ShortcutKeys) {
            let released = plugin_shortcut(keys)
                .ok()
                .map(|shortcut| self.0.global_shortcut().unregister(shortcut));
            if let Some(Err(error)) = released {
                tracing::warn!(%error, "could not release the global shortcut");
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

    /// Starts the plugin and registers the stored shortcut.
    pub(crate) fn start(app: &AppHandle, settings: &GlobalShortcut) {
        app.manage(GlobalShortcuts::default());
        let plugin = tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state == ShortcutState::Pressed
                    && app.state::<GlobalShortcuts>().takes_press()
                {
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

    /// Registers the shortcut of new settings, before they are stored.
    pub(crate) fn apply(app: &AppHandle, settings: &GlobalShortcut) -> anyhow::Result<()> {
        app.state::<GlobalShortcuts>()
            .apply(&PluginRegistrar(app), settings)
    }

    pub(super) fn status(app: &AppHandle) -> GlobalShortcutStatus {
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
    use sidekyk_core::modules::settings::{GlobalShortcut, GlobalShortcutStatus};

    /// Linux registers no shortcut: there is nothing to start.
    pub(crate) fn start(_app: &AppHandle, _settings: &GlobalShortcut) {}

    /// Linux registers no shortcut: new settings only need storing.
    pub(crate) fn apply(_app: &AppHandle, _settings: &GlobalShortcut) -> anyhow::Result<()> {
        Ok(())
    }

    /// The command to give the desktop's shortcut.
    pub(super) fn status(_app: &AppHandle) -> GlobalShortcutStatus {
        GlobalShortcutStatus::Command {
            command: toggle_command(),
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
