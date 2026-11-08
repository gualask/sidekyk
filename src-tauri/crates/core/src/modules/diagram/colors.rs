//! The app's colors as Mermaid's theme: its `base` theme, its variables set from the tokens the
//! frontend sends, each opaque (Mermaid derives shades from them, which it cannot from a
//! translucent color).

use anyhow::Context as _;
use serde_json::{json, Map, Value};

use super::contracts::DiagramColors;

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
    let color = |name: &str, value: &str| -> anyhow::Result<String> {
        Ok(parse(value)
            .with_context(|| format!("{name} color {value:?}"))?
            .over(background)
            .hex())
    };
    anyhow::ensure!(!colors.series.is_empty(), "no series colors");
    let bg = background.hex();
    let node = color("node", &colors.node)?;
    let node_border = color("node border", &colors.node_border)?;
    let cluster = color("cluster", &colors.cluster)?;
    let cluster_border = color("cluster border", &colors.cluster_border)?;
    let text = color("text", &colors.text)?;
    let line = color("line", &colors.line)?;
    let note = color("note", &colors.note)?;
    let note_border = color("note border", &colors.note_border)?;
    let note_text = color("note text", &colors.note_text)?;
    let accent = color("accent", &colors.accent)?;
    let accent_soft = color("accent soft", &colors.accent_soft)?;
    let on_dark = color("on dark", &colors.on_dark)?;
    let on_light = color("on light", &colors.on_light)?;

    let named: [(&str, &str); 68] = [
        ("background", &bg),
        ("primaryColor", &node),
        ("primaryTextColor", &text),
        ("primaryBorderColor", &node_border),
        ("secondaryColor", &cluster),
        ("secondaryTextColor", &text),
        ("secondaryBorderColor", &cluster_border),
        ("tertiaryColor", &bg),
        ("tertiaryTextColor", &text),
        ("tertiaryBorderColor", &cluster_border),
        ("mainBkg", &node),
        ("nodeBorder", &node_border),
        ("nodeTextColor", &text),
        ("clusterBkg", &cluster),
        ("clusterBorder", &cluster_border),
        ("lineColor", &line),
        ("textColor", &text),
        ("titleColor", &text),
        ("labelTextColor", &text),
        ("edgeLabelBackground", &bg),
        ("noteBkgColor", &note),
        ("noteBorderColor", &note_border),
        ("noteTextColor", &note_text),
        ("actorBkg", &node),
        ("actorBorder", &node_border),
        ("actorTextColor", &text),
        ("actorLineColor", &line),
        ("signalColor", &text),
        ("signalTextColor", &text),
        ("labelBoxBkgColor", &node),
        ("labelBoxBorderColor", &node_border),
        ("loopTextColor", &text),
        ("activationBkgColor", &accent_soft),
        ("activationBorderColor", &accent),
        ("sequenceNumberColor", &on_dark),
        ("classText", &text),
        ("attributeBackgroundColorOdd", &node),
        ("attributeBackgroundColorEven", &cluster),
        ("pieTitleTextColor", &text),
        ("pieSectionTextColor", &on_dark),
        ("pieLegendTextColor", &text),
        ("pieStrokeColor", &bg),
        ("pieOuterStrokeColor", &node_border),
        ("taskBkgColor", &accent),
        ("taskBorderColor", &accent),
        ("taskTextColor", &on_dark),
        ("taskTextOutsideColor", &text),
        ("taskTextLightColor", &on_dark),
        ("taskTextDarkColor", &text),
        ("activeTaskBkgColor", &accent_soft),
        ("activeTaskBorderColor", &accent),
        ("gridColor", &cluster_border),
        ("todayLineColor", &note_border),
        ("quadrant1Fill", &node),
        ("quadrant2Fill", &cluster),
        ("quadrant3Fill", &node),
        ("quadrant4Fill", &cluster),
        ("quadrant1TextFill", &text),
        ("quadrant2TextFill", &text),
        ("quadrant3TextFill", &text),
        ("quadrant4TextFill", &text),
        ("quadrantPointFill", &accent),
        ("quadrantPointTextFill", &text),
        ("quadrantTitleFill", &text),
        ("quadrantXAxisTextFill", &text),
        ("quadrantYAxisTextFill", &text),
        ("quadrantExternalBorderStrokeFill", &node_border),
        ("quadrantInternalBorderStrokeFill", &cluster_border),
    ];
    let mut map: Map<String, Value> = named
        .into_iter()
        .map(|(key, value)| (key.to_string(), Value::String(value.to_string())))
        .collect();
    map.insert("darkMode".into(), Value::Bool(colors.dark));
    insert(&mut map, "fontFamily".into(), FONT_FAMILY.into());
    insert(&mut map, "fontSize".into(), format!("{FONT_SIZE}px"));
    // Mermaid's scales: 12 colors for a mind map or a timeline, 12 for a pie, 8 for git
    for index in 0..12 {
        let value = &colors.series[index % colors.series.len()];
        let series = parse(value)
            .with_context(|| format!("series color {value:?}"))?
            .over(background);
        let label = if series.is_light() {
            &on_light
        } else {
            &on_dark
        };
        insert(&mut map, format!("cScale{index}"), series.hex());
        insert(&mut map, format!("cScaleLabel{index}"), label.clone());
        insert(&mut map, format!("pie{}", index + 1), series.hex());
        if index < 8 {
            insert(&mut map, format!("git{index}"), series.hex());
            insert(&mut map, format!("gitBranchLabel{index}"), label.clone());
        }
    }
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

fn insert(map: &mut Map<String, Value>, key: String, value: String) {
    map.insert(key, Value::String(value));
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rgb {
    r: f64,
    g: f64,
    b: f64,
}

impl Rgb {
    const WHITE: Rgb = Rgb {
        r: 255.0,
        g: 255.0,
        b: 255.0,
    };

    fn hex(self) -> String {
        let channel = |value: f64| value.round().clamp(0.0, 255.0) as u8;
        format!(
            "#{:02x}{:02x}{:02x}",
            channel(self.r),
            channel(self.g),
            channel(self.b)
        )
    }

    /// Whether dark text reads better on it: its relative luminance (WCAG) past the middle.
    fn is_light(self) -> bool {
        let linear = |value: f64| {
            let value = value / 255.0;
            if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * linear(self.r) + 0.7152 * linear(self.g) + 0.0722 * linear(self.b) > 0.4
    }
}

/// A color with its opacity, from 0 to 1.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rgba {
    rgb: Rgb,
    alpha: f64,
}

impl Rgba {
    /// The color as it shows laid over `below`.
    fn over(self, below: Rgb) -> Rgb {
        let mix = |top: f64, bottom: f64| top * self.alpha + bottom * (1.0 - self.alpha);
        Rgb {
            r: mix(self.rgb.r, below.r),
            g: mix(self.rgb.g, below.g),
            b: mix(self.rgb.b, below.b),
        }
    }
}

/// A token's value: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)` or `rgba(r, g, b, a)`, as a
/// stylesheet writes them and a computed style gives them.
fn parse(value: &str) -> Option<Rgba> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        let digit = |index: usize, width: usize| {
            u8::from_str_radix(hex.get(index..index + width)?, 16)
                .ok()
                .map(|value| {
                    if width == 1 {
                        f64::from(value * 17)
                    } else {
                        f64::from(value)
                    }
                })
        };
        let (width, alpha) = match hex.len() {
            3 => (1, None),
            6 => (2, None),
            8 => (2, Some(digit(6, 2)? / 255.0)),
            _ => return None,
        };
        return Some(Rgba {
            rgb: Rgb {
                r: digit(0, width)?,
                g: digit(width, width)?,
                b: digit(2 * width, width)?,
            },
            alpha: alpha.unwrap_or(1.0),
        });
    }
    let inner = value
        .strip_prefix("rgba(")
        .or_else(|| value.strip_prefix("rgb("))?
        .strip_suffix(')')?;
    let parts: Vec<f64> = inner
        .split([',', ' ', '/'])
        .filter(|part| !part.is_empty())
        .map(|part| part.parse().ok())
        .collect::<Option<_>>()?;
    let (rgb, alpha) = match parts.as_slice() {
        [r, g, b] => ([*r, *g, *b], 1.0),
        [r, g, b, a] => ([*r, *g, *b], *a),
        _ => return None,
    };
    Some(Rgba {
        rgb: Rgb {
            r: rgb[0],
            g: rgb[1],
            b: rgb[2],
        },
        alpha: alpha.clamp(0.0, 1.0),
    })
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
    fn colors_read_as_a_stylesheet_and_a_computed_style_write_them() {
        let opaque = |value: &str| parse(value).map(|color| color.over(Rgb::WHITE).hex());
        assert_eq!(opaque("#6366f1").as_deref(), Some("#6366f1"));
        assert_eq!(opaque("#fff").as_deref(), Some("#ffffff"));
        assert_eq!(opaque("rgb(99, 102, 241)").as_deref(), Some("#6366f1"));
        assert_eq!(opaque("rgb(99 102 241 / 1)").as_deref(), Some("#6366f1"));
        assert_eq!(opaque(" #000000ff ").as_deref(), Some("#000000"));
        assert_eq!(opaque("color-mix(in srgb, red, blue)"), None);
        assert_eq!(opaque("#12"), None);
        assert_eq!(opaque("rgb(1, 2)"), None);
    }

    #[test]
    fn a_translucent_color_is_laid_over_the_background() {
        let border = parse("rgba(255, 255, 255, 0.2)").unwrap();
        let background = parse("#30333f").unwrap().over(Rgb::WHITE);
        // 0.2 of white over #30333f
        assert_eq!(border.over(background).hex(), "#595c65");
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
