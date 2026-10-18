//! Wire contracts shared with the frontend (`src/modules/repository/model/repository.types.ts`).

use serde::{Deserialize, Serialize};

use crate::modules::repository::FileVersion;

/// The colors of some lines of one version of a file.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxRequest {
    pub path: String,
    pub version: FileVersion,
    /// The first line asked for, from 1.
    pub first: u32,
    /// How many lines, at most `MAX_LINES_ASKED`.
    pub count: u32,
}

/// What a part of a line is, for its color: the scopes of a grammar, folded into the few colors
/// of the theme (One Dark, One Light).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tone {
    Comment,
    String,
    /// An escape in a string (`\n`).
    Escape,
    /// Numbers, `true`, `null`, regular expressions, `self`.
    Literal,
    Constant,
    Keyword,
    Operator,
    Function,
    Type,
    Tag,
    Attribute,
    Property,
    Parameter,
    /// A Markdown heading.
    Title,
    Link,
    /// The lines a patch file adds or removes.
    Inserted,
    Deleted,
}

/// One line's colors: each colored part's start and end, in UTF-16 units as the frontend counts,
/// in order; the rest of the line keeps the text's color. `check` is the FNV-1a hash of the line's
/// UTF-16 units: the frontend colors a line only when its own text has the same, so colors read
/// before the file changed never land on other text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineColors {
    pub check: u32,
    pub spans: Vec<(u32, u32, Tone)>,
}

/// The colors of the lines asked for, fewer past the end of the file; none when the file has no
/// grammar, or is binary, missing or too large.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxColors {
    /// Larger than `MAX_COLORED_BYTES`: shown without colors, which the viewer says.
    pub too_large: bool,
    pub lines: Vec<LineColors>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn requests_and_colors_use_the_frontend_names() {
        let request: SyntaxRequest = serde_json::from_value(json!({
            "path": "src/a.rs",
            "version": { "kind": "commit", "sha": "abc1234" },
            "first": 257,
            "count": 256,
        }))
        .unwrap();
        assert_eq!(
            request.version,
            FileVersion::Commit {
                sha: "abc1234".into()
            }
        );
        for (kind, version) in [
            ("worktree", FileVersion::Worktree),
            ("index", FileVersion::Index),
            ("head", FileVersion::Head),
        ] {
            let parsed: FileVersion = serde_json::from_value(json!({ "kind": kind })).unwrap();
            assert_eq!(parsed, version);
        }

        let colors = SyntaxColors {
            too_large: false,
            lines: vec![LineColors {
                check: 7,
                spans: vec![(0, 2, Tone::Keyword), (3, 7, Tone::Function)],
            }],
        };
        assert_eq!(
            serde_json::to_value(colors).unwrap(),
            json!({
                "tooLarge": false,
                "lines": [{ "check": 7, "spans": [[0, 2, "keyword"], [3, 7, "function"]] }],
            })
        );
    }
}
