//! Wire contracts shared with the frontend (`src/modules/repository/model/repository.types.ts`).

use serde::{Deserialize, Serialize};

/// A Mermaid diagram to draw, in the app's colors.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramRequest {
    pub source: String,
    pub colors: DiagramColors,
}

/// The app's colors a diagram is drawn in: each the value of a `--ui-*` token as the page has it
/// (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`), a translucent one laid over `background`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramColors {
    /// The theme on screen: Mermaid derives its other colors for it.
    pub dark: bool,
    /// Behind the diagram: the preview's background.
    pub background: String,
    pub node: String,
    pub node_border: String,
    /// A group of nodes (a subgraph, a composite state).
    pub cluster: String,
    pub cluster_border: String,
    pub text: String,
    /// Edges and arrows.
    pub line: String,
    pub note: String,
    pub note_border: String,
    pub note_text: String,
    pub accent: String,
    pub accent_soft: String,
    /// Text on a series color: the light one on a dark color, the dark one on a light color.
    pub on_dark: String,
    pub on_light: String,
    /// The colors of a diagram's series in turn: a mind map's branches, a pie's slices, git
    /// branches. At least one.
    pub series: Vec<String>,
}

/// A diagram drawn, or why it is not.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Diagram {
    /// An SVG that holds its font and runs nothing, shown as an image, its size in CSS pixels.
    Drawn {
        svg: String,
        width: u32,
        height: u32,
    },
    /// The source is not a diagram Mermaid reads: `detail` says why, in merman's words
    /// (`No Mermaid diagram type detected`, a parse error), when it gives a reason.
    Invalid { detail: Option<String> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagrams_serialize_with_the_frontend_field_names() {
        assert_eq!(
            serde_json::to_value(Diagram::Drawn {
                svg: "<svg/>".into(),
                width: 120,
                height: 80,
            })
            .unwrap(),
            serde_json::json!({ "kind": "drawn", "svg": "<svg/>", "width": 120, "height": 80 })
        );
        assert_eq!(
            serde_json::to_value(Diagram::Invalid {
                detail: Some("line 2".into())
            })
            .unwrap(),
            serde_json::json!({ "kind": "invalid", "detail": "line 2" })
        );
    }

    #[test]
    fn a_request_reads_the_frontend_field_names() {
        let request: DiagramRequest = serde_json::from_value(serde_json::json!({
            "source": "flowchart TD\n  A --> B",
            "colors": {
                "dark": true, "background": "#30333f", "node": "#2c2f3a",
                "nodeBorder": "rgba(255, 255, 255, 0.2)", "cluster": "#363a47",
                "clusterBorder": "rgba(255, 255, 255, 0.1)", "text": "#f4f6fb", "line": "#9aa4b6",
                "note": "rgba(69, 26, 3, 0.6)", "noteBorder": "#fbbf24", "noteText": "#fde68a",
                "accent": "#6366f1", "accentSoft": "rgba(99, 102, 241, 0.15)",
                "onDark": "#ffffff", "onLight": "#1f1300", "series": ["#6366f1", "#0ea5e9"]
            }
        }))
        .unwrap();
        assert!(request.colors.dark);
        assert_eq!(request.colors.node_border, "rgba(255, 255, 255, 0.2)");
        assert_eq!(request.colors.series.len(), 2);
    }
}
