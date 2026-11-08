//! Mermaid diagrams for the preview, drawn by merman as an SVG the webview shows as an image: in
//! the app's colors and font, sized, running nothing. Pure: the source comes from the caller.

mod colors;
mod contracts;
mod fonts;

use std::time::{Duration, Instant};

use merman::svg::SvgEnvironment;
use merman::{
    Engine, MermaidConfig, OperationControl, RenderOutput, RenderRequest, Renderer, SvgRequest,
};

pub use contracts::{Diagram, DiagramColors, DiagramRequest};

/// Mermaid's own limit on a diagram's text (`maxTextSize`, 50,000 characters) at 4 bytes a
/// character at most: a longer source is refused before merman reads it.
const MAX_SOURCE_BYTES: usize = 200_000;

/// A diagram that takes longer is given up (merman checks between its steps).
const DEADLINE: Duration = Duration::from_secs(5);

/// The diagram a source draws, in `colors`. A source Mermaid does not read is `Invalid`; a color
/// that does not read, or a source past the limit, fails.
pub fn render_diagram(request: &DiagramRequest) -> anyhow::Result<Diagram> {
    anyhow::ensure!(
        request.source.len() <= MAX_SOURCE_BYTES,
        "a diagram of {} bytes is past the limit",
        request.source.len()
    );
    let started = Instant::now();
    let config = MermaidConfig::from_value(colors::theme_config(&request.colors)?);
    let renderer = Renderer::new().with_engine(Engine::new().with_site_config(config));
    let environment = SvgEnvironment::deterministic()
        .with_native_font_context(fonts::measured()?.clone())
        .map_err(|error| anyhow::anyhow!("the diagrams' font: {error}"))?;
    let svg_request = SvgRequest {
        environment,
        ..SvgRequest::default()
    };
    let rendered = renderer.render(RenderRequest::svg(
        &request.source,
        OperationControl::new().with_deadline(DEADLINE),
        svg_request,
    ));
    let diagram = match rendered {
        Ok(RenderOutput::Svg(Some(svg))) => finished(svg.svg())?,
        Ok(_) => Diagram::Invalid { detail: None },
        Err(error) => Diagram::Invalid {
            detail: Some(error.to_string()),
        },
    };
    let ms = started.elapsed().as_millis() as u64;
    let drawn = matches!(diagram, Diagram::Drawn { .. });
    tracing::debug!(ms, bytes = request.source.len(), drawn, "diagram");
    Ok(diagram)
}

/// merman's SVG as an image shows it: its size from its view box (as an image an SVG sized
/// `100%` has none of its own), and the font it was measured with, cut to its characters.
fn finished(svg: &str) -> anyhow::Result<Diagram> {
    let root_end = svg
        .find('>')
        .filter(|_| svg.starts_with("<svg"))
        .ok_or_else(|| anyhow::anyhow!("merman's output is not an SVG"))?;
    let root = &svg[..root_end];
    let view_box = attribute(root, "viewBox")
        .ok_or_else(|| anyhow::anyhow!("merman's SVG has no view box"))?;
    let numbers: Vec<f64> = view_box
        .split([' ', ','])
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect();
    let [_, _, width, height] = numbers[..] else {
        anyhow::bail!("merman's view box {view_box:?} does not read");
    };
    let (width, height) = (width.ceil().max(1.0) as u32, height.ceil().max(1.0) as u32);

    // the root's own width and style (`max-width`) leave; its size is the view box's
    let root = without_attribute(&without_attribute(root, "width"), "style");
    let font = fonts::style(svg)?;
    let mut out = String::with_capacity(svg.len() + font.len() + 64);
    out.push_str(&root);
    out.push_str(&format!(" width=\"{width}\" height=\"{height}\">"));
    let body = &svg[root_end + 1..];
    match body.strip_prefix("<style>") {
        Some(styles) => {
            out.push_str("<style>");
            out.push_str(&font);
            out.push_str(styles);
        }
        None => {
            out.push_str("<style>");
            out.push_str(&font);
            out.push_str("</style>");
            out.push_str(body);
        }
    }
    Ok(Diagram::Drawn {
        svg: out,
        width,
        height,
    })
}

/// The value of an attribute of a tag, written `name="value"`.
fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let start = tag.find(&format!(" {name}=\""))? + name.len() + 3;
    let length = tag[start..].find('"')?;
    Some(&tag[start..start + length])
}

/// A tag without one of its attributes, written `name="value"`; as it is without it.
fn without_attribute(tag: &str, name: &str) -> String {
    let Some(start) = tag.find(&format!(" {name}=\"")) else {
        return tag.to_string();
    };
    let value_start = start + name.len() + 3;
    match tag[value_start..].find('"') {
        Some(length) => format!("{}{}", &tag[..start], &tag[value_start + length + 1..]),
        None => tag.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::colors::tests::light;
    use super::*;

    fn draw(source: &str) -> Diagram {
        render_diagram(&DiagramRequest {
            source: source.into(),
            colors: light(),
        })
        .unwrap()
    }

    #[test]
    fn a_flowchart_is_drawn_sized_with_its_font() {
        let Diagram::Drawn { svg, width, height } =
            draw("flowchart TD\n  A[Agent edits] --> B{Ignored?}")
        else {
            panic!("not drawn");
        };
        assert!(width > 50 && height > 100, "{width}x{height}");
        let root = &svg[..svg.find('>').unwrap()];
        assert!(
            root.contains(&format!(" width=\"{width}\" height=\"{height}\"")),
            "{root}"
        );
        assert!(
            !root.contains("100%") && !root.contains("max-width"),
            "{root}"
        );
        assert!(svg.contains("@font-face{font-family:'Plus Jakarta Sans'"));
        assert!(svg.contains("Agent edits"));
        // the theme's node color
        assert!(svg.contains("#ffffff"));
        assert!(!svg.contains("<script"));
    }

    #[test]
    fn a_source_that_does_not_read_is_invalid() {
        let Diagram::Invalid { detail } = draw("flowchart TD\n  A --> ") else {
            panic!("drawn");
        };
        assert!(
            detail
                .as_deref()
                .is_some_and(|text| text.contains("unexpected end of input")),
            "{detail:?}"
        );
        let Diagram::Invalid { detail } = draw("not a diagram") else {
            panic!("drawn");
        };
        assert!(detail.is_some());
    }

    #[test]
    fn a_source_past_the_limit_fails() {
        let source = format!("flowchart TD\n{}", "  A --> B\n".repeat(30_000));
        assert!(render_diagram(&DiagramRequest {
            source,
            colors: light(),
        })
        .is_err());
    }

    #[test]
    fn the_root_keeps_its_other_attributes() {
        let Diagram::Drawn { svg, .. } =
            finished(r#"<svg id="merman" width="100%" style="max-width: 10px;" viewBox="0 0 10.2 20"><style>a{}</style><g/></svg>"#)
                .unwrap()
        else {
            panic!("not drawn");
        };
        assert!(
            svg.starts_with(
                r#"<svg id="merman" viewBox="0 0 10.2 20" width="11" height="20"><style>@font-face"#
            ),
            "{}",
            &svg[..120]
        );
        assert!(svg.ends_with("foreignObject{overflow:visible}a{}</style><g/></svg>"));
    }
}
