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

/// Every setting. Also the form they are stored in: a setting missing from the stored ones, such
/// as one added since they were stored, takes its default.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Settings {
    pub(crate) theme: Theme,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_serialize_with_the_frontend_field_names() {
        let settings = Settings {
            theme: Theme::Light,
        };
        let json = serde_json::json!({ "theme": "light" });
        assert_eq!(serde_json::to_value(&settings).unwrap(), json);
        assert_eq!(serde_json::from_value::<Settings>(json).unwrap(), settings);
    }

    #[test]
    fn missing_settings_take_their_defaults() {
        assert_eq!(
            serde_json::from_value::<Settings>(serde_json::json!({})).unwrap(),
            Settings { theme: Theme::Dark }
        );
    }
}
