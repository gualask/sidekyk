//! The app's colors as Mermaid's theme: its `base` theme, its variables set from the tokens the
//! frontend sends, each opaque (Mermaid derives shades from them, which it cannot from a
//! translucent color).

use anyhow::Context as _;
use serde_json::{json, Map, Value};

use super::contracts::DiagramColors;
use super::css_color::{parse, Rgb};

/// The family the labels are measured and drawn in (`fonts.rs`).
pub(super) const FONT_FAMILY: &str = "Plus Jakarta Sans";

/// The labels' size: the Markdown preview's text (`MarkdownPreview`), not Mermaid's 16 px. The
/// diagrams whose main text has a size of its own at 16 px take it too; their smaller ones (an
/// actor, a note, an ER attribute) stay as Mermaid scales them.
const FONT_SIZE: f64 = 14.5;

/// Mermaid's site configuration for a diagram in these colors. A diagram's own `%%{init}%%`,
/// `style` and `classDef` still win: the author chose them.
pub(super) fn theme_config(colors: &DiagramColors) -> anyhow::Result<Value> {
    let background = parse(&colors.background)
        .with_context(|| format!("background color {:?}", colors.background))?
        .over(Rgb::WHITE);
    anyhow::ensure!(!colors.series.is_empty(), "no series colors");
    let palette = Palette::new(colors, background)?;
    let mut map = named_variables(&palette);
    map.insert("darkMode".into(), Value::Bool(colors.dark));
    insert(&mut map, "fontFamily".into(), FONT_FAMILY.into());
    insert(&mut map, "fontSize".into(), format!("{FONT_SIZE}px"));
    insert_series(&mut map, &colors.series, background, &palette)?;
    Ok(json!({
        "theme": "base",
        "darkMode": colors.dark,
        "fontFamily": FONT_FAMILY,
        "fontSize": FONT_SIZE,
        "sequence": { "messageFontSize": FONT_SIZE },
        "architecture": { "fontSize": FONT_SIZE },
        "themeVariables": map,
    }))
}

/// The app's colors, each opaque over the background, as hex.
struct Palette {
    bg: String,
    node: String,
    node_border: String,
    cluster: String,
    cluster_border: String,
    text: String,
    line: String,
    note: String,
    note_border: String,
    note_text: String,
    accent: String,
    accent_soft: String,
    on_dark: String,
    on_light: String,
}

impl Palette {
    /// Each of `colors` laid over `background`; one that does not read is named in the error.
    fn new(colors: &DiagramColors, background: Rgb) -> anyhow::Result<Self> {
        let color = |name: &str, value: &str| -> anyhow::Result<String> {
            Ok(parse(value)
                .with_context(|| format!("{name} color {value:?}"))?
                .over(background)
                .hex())
        };
        Ok(Self {
            bg: background.hex(),
            node: color("node", &colors.node)?,
            node_border: color("node border", &colors.node_border)?,
            cluster: color("cluster", &colors.cluster)?,
            cluster_border: color("cluster border", &colors.cluster_border)?,
            text: color("text", &colors.text)?,
            line: color("line", &colors.line)?,
            note: color("note", &colors.note)?,
            note_border: color("note border", &colors.note_border)?,
            note_text: color("note text", &colors.note_text)?,
            accent: color("accent", &colors.accent)?,
            accent_soft: color("accent soft", &colors.accent_soft)?,
            on_dark: color("on dark", &colors.on_dark)?,
            on_light: color("on light", &colors.on_light)?,
        })
    }
}

/// Mermaid's theme variables named after a role, each to one of the palette's colors.
fn named_variables(p: &Palette) -> Map<String, Value> {
    let named: [(&str, &str); 68] = [
        ("background", &p.bg),
        ("primaryColor", &p.node),
        ("primaryTextColor", &p.text),
        ("primaryBorderColor", &p.node_border),
        ("secondaryColor", &p.cluster),
        ("secondaryTextColor", &p.text),
        ("secondaryBorderColor", &p.cluster_border),
        ("tertiaryColor", &p.bg),
        ("tertiaryTextColor", &p.text),
        ("tertiaryBorderColor", &p.cluster_border),
        ("mainBkg", &p.node),
        ("nodeBorder", &p.node_border),
        ("nodeTextColor", &p.text),
        ("clusterBkg", &p.cluster),
        ("clusterBorder", &p.cluster_border),
        ("lineColor", &p.line),
        ("textColor", &p.text),
        ("titleColor", &p.text),
        ("labelTextColor", &p.text),
        ("edgeLabelBackground", &p.bg),
        ("noteBkgColor", &p.note),
        ("noteBorderColor", &p.note_border),
        ("noteTextColor", &p.note_text),
        ("actorBkg", &p.node),
        ("actorBorder", &p.node_border),
        ("actorTextColor", &p.text),
        ("actorLineColor", &p.line),
        ("signalColor", &p.text),
        ("signalTextColor", &p.text),
        ("labelBoxBkgColor", &p.node),
        ("labelBoxBorderColor", &p.node_border),
        ("loopTextColor", &p.text),
        ("activationBkgColor", &p.accent_soft),
        ("activationBorderColor", &p.accent),
        ("sequenceNumberColor", &p.on_dark),
        ("classText", &p.text),
        ("attributeBackgroundColorOdd", &p.node),
        ("attributeBackgroundColorEven", &p.cluster),
        ("pieTitleTextColor", &p.text),
        ("pieSectionTextColor", &p.on_dark),
        ("pieLegendTextColor", &p.text),
        ("pieStrokeColor", &p.bg),
        ("pieOuterStrokeColor", &p.node_border),
        ("taskBkgColor", &p.accent),
        ("taskBorderColor", &p.accent),
        ("taskTextColor", &p.on_dark),
        ("taskTextOutsideColor", &p.text),
        ("taskTextLightColor", &p.on_dark),
        ("taskTextDarkColor", &p.text),
        ("activeTaskBkgColor", &p.accent_soft),
        ("activeTaskBorderColor", &p.accent),
        ("gridColor", &p.cluster_border),
        ("todayLineColor", &p.note_border),
        ("quadrant1Fill", &p.node),
        ("quadrant2Fill", &p.cluster),
        ("quadrant3Fill", &p.node),
        ("quadrant4Fill", &p.cluster),
        ("quadrant1TextFill", &p.text),
        ("quadrant2TextFill", &p.text),
        ("quadrant3TextFill", &p.text),
        ("quadrant4TextFill", &p.text),
        ("quadrantPointFill", &p.accent),
        ("quadrantPointTextFill", &p.text),
        ("quadrantTitleFill", &p.text),
        ("quadrantXAxisTextFill", &p.text),
        ("quadrantYAxisTextFill", &p.text),
        ("quadrantExternalBorderStrokeFill", &p.node_border),
        ("quadrantInternalBorderStrokeFill", &p.cluster_border),
    ];
    named
        .into_iter()
        .map(|(key, value)| (key.to_string(), Value::String(value.to_string())))
        .collect()
}

/// Mermaid's scales, from the series colors, which repeat: 12 colors for a mind map or a
/// timeline, 12 for a pie, 8 for git; each with a label color that reads on it.
fn insert_series(
    map: &mut Map<String, Value>,
    series: &[String],
    background: Rgb,
    palette: &Palette,
) -> anyhow::Result<()> {
    for index in 0..12 {
        let value = &series[index % series.len()];
        let color = parse(value)
            .with_context(|| format!("series color {value:?}"))?
            .over(background);
        let label = if color.is_light() {
            &palette.on_light
        } else {
            &palette.on_dark
        };
        insert(map, format!("cScale{index}"), color.hex());
        insert(map, format!("cScaleLabel{index}"), label.clone());
        insert(map, format!("pie{}", index + 1), color.hex());
        if index < 8 {
            insert(map, format!("git{index}"), color.hex());
            insert(map, format!("gitBranchLabel{index}"), label.clone());
        }
    }
    Ok(())
}

fn insert(map: &mut Map<String, Value>, key: String, value: String) {
    map.insert(key, Value::String(value));
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    /// The light theme's tokens (`src/shared/ui/theme.css`).
    pub(crate) fn light() -> DiagramColors {
        DiagramColors {
            dark: false,
            background: "#f8fafc".into(),
            node: "#ffffff".into(),
            node_border: "#cbd5e1".into(),
            cluster: "#f1f4f8".into(),
            cluster_border: "#e2e8f0".into(),
            text: "#0f172a".into(),
            line: "#5b677a".into(),
            note: "#fffbeb".into(),
            note_border: "#d97706".into(),
            note_text: "#92400e".into(),
            accent: "#6366f1".into(),
            accent_soft: "#eef2ff".into(),
            on_dark: "#ffffff".into(),
            on_light: "#1f1300".into(),
            series: vec!["#6366f1".into(), "#f59e0b".into()],
        }
    }

    #[test]
    fn series_labels_read_on_their_color() {
        let config = theme_config(&light()).unwrap();
        let variables = &config["themeVariables"];
        assert_eq!(variables["cScale0"], "#6366f1");
        assert_eq!(variables["cScaleLabel0"], "#ffffff");
        // amber is light: dark text on it
        assert_eq!(variables["cScale1"], "#f59e0b");
        assert_eq!(variables["cScaleLabel1"], "#1f1300");
        // the series repeat
        assert_eq!(variables["pie12"], "#f59e0b");
        assert_eq!(variables["git7"], "#f59e0b");
        assert_eq!(config["theme"], "base");
        assert_eq!(variables["fontFamily"], FONT_FAMILY);
        assert_eq!(variables["fontSize"], "14.5px");
        assert_eq!(config["fontSize"], 14.5);
        assert_eq!(config["sequence"]["messageFontSize"], 14.5);
    }

    #[test]
    fn a_color_that_does_not_read_is_named() {
        let mut colors = light();
        colors.line = "var(--ui-text-muted)".into();
        let error = theme_config(&colors).unwrap_err();
        assert!(format!("{error:#}").contains("line color"), "{error:#}");
        colors = light();
        colors.series.clear();
        assert!(theme_config(&colors).is_err());
    }
}
