//! Wire contracts shared with the frontend (`src/modules/settings/model/settings.types.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

/// The app's colors. It no longer follows the system's.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

/// The language of the UI, and of the text the backend writes for it (the tray, dialogs, an
/// export).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    En,
    It,
}

/// The view a diff opens in: only the changed lines, or the whole file with its changes marked.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffView {
    #[default]
    Changes,
    File,
}

/// How a file that has a preview (Markdown, SVG) opens: as it reads, or its text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileView {
    #[default]
    Preview,
    Code,
}

/// How wide the scrollbar beside a diff is, the map of its changes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffScrollbar {
    #[default]
    Narrow,
    Wide,
}

/// How the viewer shows a line of code longer than its width, in diffs and files alike: on one
/// row, scrolled sideways (as in VS Code and Zed), or wrapped at the edge.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeLines {
    #[default]
    Scroll,
    Wrap,
}

/// How a note's long lines show: wrapped at the panel's edge, or on one line, scrolled sideways.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteLines {
    #[default]
    Wrap,
    Scroll,
}

/// What a copy from a diff puts on the clipboard: `{row}` becomes where the text is
/// (`src/cart.ts:14`, `src/cart.ts:12-15`) and `{text}` the text copied. The frontend fills it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct CopyTemplate(String);

/// The default: where, then what, with no formatting that could break where it is pasted.
pub const DEFAULT_COPY_TEMPLATE: &str = "{row}\n{text}";

impl Default for CopyTemplate {
    fn default() -> Self {
        Self(DEFAULT_COPY_TEMPLATE.to_string())
    }
}

/// A template with no placeholder copies the same text whatever is clicked: one stored so (by a
/// hand-edited file; the settings refuse it) takes the default.
impl<'de> Deserialize<'de> for CopyTemplate {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let template = String::deserialize(deserializer)?;
        if template.contains("{row}") || template.contains("{text}") {
            Ok(Self(template))
        } else {
            Ok(Self::default())
        }
    }
}

/// The shortcut that shows and hides the window from any app, on by default. Its default keys are
/// provisional: the maintainer picks them once the conflict warnings have been tried.
pub const DEFAULT_GLOBAL_SHORTCUT: &str = "Control+Alt+Space";

/// The shortcut that shows and hides the window from any app. `keys` is its combination:
/// modifiers (`Control`, `Alt`, `Shift`, `Super`, in this order), then a `KeyboardEvent.code`,
/// joined by `+`, as `global-hotkey` parses it. Kept on Linux, which registers none of its own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GlobalShortcut {
    pub enabled: bool,
    pub keys: String,
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
pub struct Settings {
    /// `None` until the frontend stores the system's language, at the first start.
    pub language: Option<Language>,
    pub theme: Theme,
    pub global_shortcut: GlobalShortcut,
    pub diff_view: DiffView,
    pub file_view: FileView,
    pub diff_scrollbar: DiffScrollbar,
    pub code_lines: CodeLines,
    pub copy_template: CopyTemplate,
    /// The sidebars' widths in pixels, as last dragged, by sidebar (`files`, `changes`, `notes`);
    /// one missing takes its default.
    pub sidebar_widths: BTreeMap<String, u32>,
    pub note_lines: NoteLines,
}

/// Where the global shortcut stands, as registered. The frontend knows every platform's kinds;
/// each platform builds only its own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(any(target_os = "macos", windows), derive(Default))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GlobalShortcutStatus {
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
            language: Some(Language::It),
            theme: Theme::Light,
            global_shortcut: GlobalShortcut {
                enabled: false,
                keys: "Super+Shift+KeyK".to_string(),
            },
            diff_view: DiffView::File,
            file_view: FileView::Code,
            diff_scrollbar: DiffScrollbar::Wide,
            code_lines: CodeLines::Wrap,
            copy_template: CopyTemplate("Look at {row}:\n{text}".to_string()),
            sidebar_widths: BTreeMap::from([("files".to_string(), 320)]),
            note_lines: NoteLines::Scroll,
        };
        let json = serde_json::json!({
            "language": "it",
            "theme": "light",
            "globalShortcut": { "enabled": false, "keys": "Super+Shift+KeyK" },
            "diffView": "file",
            "fileView": "code",
            "diffScrollbar": "wide",
            "codeLines": "wrap",
            "copyTemplate": "Look at {row}:\n{text}",
            "sidebarWidths": { "files": 320 },
            "noteLines": "scroll",
        });
        assert_eq!(serde_json::to_value(&settings).unwrap(), json);
        assert_eq!(serde_json::from_value::<Settings>(json).unwrap(), settings);
    }

    #[test]
    fn missing_settings_take_their_defaults() {
        assert_eq!(
            serde_json::from_value::<Settings>(serde_json::json!({ "theme": "light" })).unwrap(),
            Settings {
                language: None,
                theme: Theme::Light,
                global_shortcut: GlobalShortcut {
                    enabled: true,
                    keys: DEFAULT_GLOBAL_SHORTCUT.to_string(),
                },
                diff_view: DiffView::Changes,
                file_view: FileView::Preview,
                diff_scrollbar: DiffScrollbar::Narrow,
                code_lines: CodeLines::Scroll,
                copy_template: CopyTemplate::default(),
                sidebar_widths: BTreeMap::new(),
                note_lines: NoteLines::Wrap,
            }
        );
    }

    #[test]
    fn a_copy_template_without_placeholders_takes_the_default() {
        let template = |value: &str| {
            serde_json::from_value::<Settings>(serde_json::json!({ "copyTemplate": value }))
                .unwrap()
                .copy_template
        };
        assert_eq!(template("Fix this"), CopyTemplate::default());
        assert_eq!(template(""), CopyTemplate::default());
        assert_eq!(template("{text}"), CopyTemplate("{text}".to_string()));
        assert_eq!(
            serde_json::to_value(CopyTemplate::default()).unwrap(),
            serde_json::json!("{row}\n{text}")
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
