//! macOS and Windows: the shortcuts registered through `tauri-plugin-global-shortcut`.

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use super::OnPress;
use crate::infrastructure::capture::CAPTURE_BUILT;
use crate::infrastructure::window::QUICK_NOTE_BUILT;
use sidekyk_core::modules::settings::{
    GlobalShortcutStatuses, GlobalShortcuts, RegisterError, Settings, ShortcutAction, ShortcutKeys,
    ShortcutRegistrar,
};

/// The plugin's ids of the capture and quick note shortcuts registered, `NONE` without one: a
/// press of any other is the window's. Apart from `GlobalShortcuts`' state, which a press must not
/// wait for.
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

    /// What the shortcut pressed does.
    fn action(&self, id: u64) -> ShortcutAction {
        if id == self.capture.load(Ordering::Relaxed) {
            ShortcutAction::Capture
        } else if id == self.note.load(Ordering::Relaxed) {
            ShortcutAction::Note
        } else {
            ShortcutAction::Toggle
        }
    }
}

const NONE: u64 = u64::MAX;

/// The shortcuts built here beside the window's.
fn built() -> Vec<ShortcutAction> {
    let mut built = Vec::new();
    if CAPTURE_BUILT {
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
    fn register(&self, action: ShortcutAction, keys: &ShortcutKeys) -> Result<(), RegisterError> {
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
        super::system_shortcuts::system_uses(keys)
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

/// Starts the plugin and registers the stored shortcuts; a press goes to `on_press`, but none
/// while a new shortcut is typed in the settings.
pub(crate) fn start(app: &AppHandle, settings: &Settings, on_press: OnPress, _toggle_flag: &str) {
    app.manage(GlobalShortcuts::new(&built()));
    app.manage(PressIds {
        capture: AtomicU64::new(NONE),
        note: AtomicU64::new(NONE),
    });
    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            if event.state != ShortcutState::Pressed
                || !app.state::<GlobalShortcuts>().takes_press()
            {
                return;
            }
            let action = app.state::<PressIds>().action(u64::from(shortcut.id()));
            on_press(app, action);
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

/// Where each shortcut stands, from memory.
pub(crate) fn status(app: &AppHandle) -> GlobalShortcutStatuses {
    app.state::<GlobalShortcuts>().status()
}

/// A new shortcut is being typed in the settings, or no longer is: no press counts meanwhile.
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
