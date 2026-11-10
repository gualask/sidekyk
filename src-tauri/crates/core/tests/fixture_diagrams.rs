//! The browser fixtures' Mermaid diagrams (`src/infrastructure/fixtures/fixture-files/diagrams.json`), drawn by the
//! real renderer in the app's two themes, so the fixtures show what the app shows: each
//! ` ```mermaid ` block of the Vault's Markdown and each `.mmd` file, their later versions
//! (`edits/vault/`) too. The colors are the page's: `theme.css`'s tokens, picked as
//! `diagram-tokens.json` says. The font each diagram carries is stored once in `styles`, the
//! same in both themes, its place in the SVG written `{{style:<index>}}`.
//! `SIDEKYK_UPDATE_FIXTURES=1 cargo test fixture_diagrams` writes the file again.

mod common;

use std::collections::{BTreeMap, HashMap};

use common::{files, fixture_files, src};
use sidekyk_core::modules::diagram::{render_diagram, Diagram, DiagramColors, DiagramRequest};
use sidekyk_core::modules::preview::{parse_markdown, Block};

const DIAGRAMS: &str = "diagrams.json";

/// The tokens a block of `theme.css` sets, from `{` after `start` to its `}`.
fn tokens_after(css: &str, start: &str) -> HashMap<String, String> {
    let at = css.find(start).expect("the theme's block") + start.len();
    let body = &css[at..at + css[at..].find('}').expect("the block's end")];
    body.split(';')
        .filter_map(|declaration| {
            let declaration = declaration.trim();
            let declaration = declaration
                .rsplit("*/")
                .next()
                .unwrap_or(declaration)
                .trim();
            let (name, value) = declaration.split_once(':')?;
            name.trim()
                .starts_with("--ui-")
                .then(|| (name.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

/// A token's value with its `var()` resolved, as a computed style gives it.
fn value(tokens: &HashMap<String, String>, token: &str) -> String {
    let value = tokens
        .get(token)
        .unwrap_or_else(|| panic!("no token {token}"));
    match value
        .strip_prefix("var(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        Some(other) => self::value(tokens, other.trim()),
        None => value.clone(),
    }
}

fn colors(dark: bool) -> DiagramColors {
    let css = std::fs::read_to_string(src().join("shared/ui/theme.css")).unwrap();
    let mut tokens = tokens_after(&css, ":root {");
    if dark {
        let media = &css[css.find("prefers-color-scheme: dark").unwrap()..];
        tokens.extend(tokens_after(media, ":root {"));
    }
    let names: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(src().join("modules/repository/model/diagram-tokens.json"))
            .unwrap(),
    )
    .unwrap();
    let mut json = serde_json::Map::new();
    for (field, token) in names.as_object().unwrap() {
        let resolved = match token {
            serde_json::Value::Array(list) => serde_json::Value::Array(
                list.iter()
                    .map(|token| value(&tokens, token.as_str().unwrap()).into())
                    .collect(),
            ),
            token => value(&tokens, token.as_str().unwrap()).into(),
        };
        json.insert(field.clone(), resolved);
    }
    json.insert("dark".into(), dark.into());
    serde_json::from_value(json.into()).unwrap()
}

/// The diagrams of a Markdown file's blocks, in order, nested ones too.
fn diagram_sources(blocks: &[Block], found: &mut Vec<String>) {
    for block in blocks {
        match block {
            Block::Diagram { source, .. } => found.push(source.clone()),
            Block::Quote { blocks, .. } => diagram_sources(blocks, found),
            Block::List { items, .. } => {
                for item in items {
                    diagram_sources(&item.blocks, found);
                }
            }
            Block::Footnotes { notes, .. } => {
                for note in notes {
                    diagram_sources(&note.blocks, found);
                }
            }
            _ => {}
        }
    }
}

#[test]
fn fixture_diagrams_are_the_renderers() {
    let root = fixture_files();
    let mut sources = Vec::new();
    for folder in ["vault", "edits/vault"] {
        for path in files(&root.join(folder)).into_keys() {
            let text = || std::fs::read_to_string(root.join(folder).join(&path)).unwrap();
            if path.ends_with(".mmd") {
                sources.push(text());
            } else if path.ends_with(".md") {
                let document = parse_markdown(&text(), &path, &|_| false, false);
                diagram_sources(&document.blocks, &mut sources);
            }
        }
    }
    assert!(sources.len() >= 2, "the fixtures hold diagrams");

    let mut styles: Vec<String> = Vec::new();
    let mut themes = BTreeMap::new();
    for (theme, dark) in [("light", false), ("dark", true)] {
        let colors = colors(dark);
        let mut diagrams = BTreeMap::new();
        for source in &sources {
            let mut diagram = render_diagram(&DiagramRequest {
                source: source.clone(),
                colors: colors.clone(),
            })
            .unwrap();
            if let Diagram::Drawn { svg, .. } = &mut diagram {
                let start = svg.find("@font-face").unwrap();
                let end = svg.find("foreignObject{overflow:visible}").unwrap()
                    + "foreignObject{overflow:visible}".len();
                let style = &svg[start..end];
                let index = match styles.iter().position(|known| known == style) {
                    Some(index) => index,
                    None => {
                        styles.push(style.to_string());
                        styles.len() - 1
                    }
                };
                svg.replace_range(start..end, &format!("{{{{style:{index}}}}}"));
            }
            diagrams.insert(source.clone(), diagram);
        }
        themes.insert(theme, diagrams);
    }
    let made = serde_json::to_string_pretty(&serde_json::json!({
        "styles": styles,
        "themes": themes,
    }))
    .unwrap()
        + "\n";

    let written = root.join(DIAGRAMS);
    if std::env::var_os("SIDEKYK_UPDATE_FIXTURES").is_some() {
        std::fs::write(&written, &made).unwrap();
    }
    let stored = std::fs::read_to_string(&written).unwrap_or_default();
    assert!(
        stored == made,
        "{} is out of date: run `SIDEKYK_UPDATE_FIXTURES=1 cargo test --manifest-path \
         src-tauri/Cargo.toml -p sidekyk-core fixture_`",
        written.display()
    );
}
