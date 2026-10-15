//! Wire contracts shared with the frontend (`src/modules/settings/model/settings.types.ts`).

use serde::{Deserialize, Serialize};

/// The app's colors. It no longer follows the system's.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Theme {
    #[default]
    Dark,
    Light,
}

/// The shortcut that shows and hides the window from any app, on by default. Its default keys are
/// provisional: the maintainer picks them once the conflict warnings have been tried.
pub(crate) const DEFAULT_GLOBAL_SHORTCUT: &str = "Control+Alt+Space";

/// The shortcut that shows and hides the window from any app. `keys` is its combination:
/// modifiers (`Control`, `Alt`, `Shift`, `Super`, in this order), then a `KeyboardEvent.code`,
/// joined by `+`, as `global-hotkey` parses it. Kept on Linux, which registers none of its own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct GlobalShortcut {
    pub(crate) enabled: bool,
    pub(crate) keys: String,
}

impl Default for GlobalShortcut {
    fn default() -> Self {
        Self {
            enabled: true,
            keys: DEFAULT_GLOBAL_SHORTCUT.to_string(),
        }
    }
}

/// Every setting. Also the form they are stored in: a setting missing from the stored ones, such
/// as one added since they were stored, takes its default.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Settings {
    pub(crate) theme: Theme,
    pub(crate) global_shortcut: GlobalShortcut,
}

/// Where the global shortcut stands, as registered. The frontend knows every platform's kinds;
/// each platform builds only its own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(any(target_os = "macos", windows), derive(Default))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum GlobalShortcutStatus {
    #[cfg(any(target_os = "macos", windows))]
    #[default]
    Off,
    /// Registered. `conflict`: macOS uses the same keys for a shortcut of its own, which gets
    /// them first.
    #[cfg(any(target_os = "macos", windows))]
    Active { keys: String, conflict: bool },
    /// The stored shortcut could not be registered at startup, as another app or the system
    /// holds it: none works.
    #[cfg(any(target_os = "macos", windows))]
    Refused { keys: String },
    /// No global shortcut on this system: the plugin could not start.
    #[cfg(any(target_os = "macos", windows))]
    Unavailable,
    /// Linux: the desktop's own shortcut runs this command, which shows or hides the window.
    #[cfg(not(any(target_os = "macos", windows)))]
    Command { command: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_serialize_with_the_frontend_field_names() {
        let settings = Settings {
            theme: Theme::Light,
            global_shortcut: GlobalShortcut {
                enabled: false,
                keys: "Super+Shift+KeyK".to_string(),
            },
        };
        let json = serde_json::json!({
            "theme": "light",
            "globalShortcut": { "enabled": false, "keys": "Super+Shift+KeyK" },
        });
        assert_eq!(serde_json::to_value(&settings).unwrap(), json);
        assert_eq!(serde_json::from_value::<Settings>(json).unwrap(), settings);
    }

    #[test]
    fn missing_settings_take_their_defaults() {
        assert_eq!(
            serde_json::from_value::<Settings>(serde_json::json!({ "theme": "light" })).unwrap(),
            Settings {
                theme: Theme::Light,
                global_shortcut: GlobalShortcut {
                    enabled: true,
                    keys: DEFAULT_GLOBAL_SHORTCUT.to_string(),
                },
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn shortcut_statuses_serialize_with_their_kind() {
        let cases = [
            (
                GlobalShortcutStatus::Off,
                serde_json::json!({ "kind": "off" }),
            ),
            (
                GlobalShortcutStatus::Active {
                    keys: "Super+Space".to_string(),
                    conflict: true,
                },
                serde_json::json!({ "kind": "active", "keys": "Super+Space", "conflict": true }),
            ),
            (
                GlobalShortcutStatus::Refused {
                    keys: "Super+Space".to_string(),
                },
                serde_json::json!({ "kind": "refused", "keys": "Super+Space" }),
            ),
            (
                GlobalShortcutStatus::Unavailable,
                serde_json::json!({ "kind": "unavailable" }),
            ),
        ];
        for (status, json) in cases {
            assert_eq!(serde_json::to_value(status).unwrap(), json);
        }
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    #[test]
    fn the_linux_status_serializes_with_its_kind() {
        let status = GlobalShortcutStatus::Command {
            command: "sidekyk --toggle".to_string(),
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({ "kind": "command", "command": "sidekyk --toggle" })
        );
    }
}
