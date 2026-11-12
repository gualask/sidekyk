//! The tones as a syntect theme: each theme color stands for a tone, so syntect's own scope
//! matching picks the tone of each part of a line.

use std::str::FromStr;
use std::sync::LazyLock;

use syntect::highlighting::{
    Color, ScopeSelectors, StyleModifier, Theme, ThemeItem, ThemeSettings,
};

use super::super::contracts::Tone;

/// Built once, the first time a file is colored.
pub(super) static THEME: LazyLock<Theme> = LazyLock::new(tone_theme);

/// Tones in theme order: a theme color's red channel is its tone's index here plus one, 0 the
/// text's own color.
const TONES: [Tone; 17] = [
    Tone::Comment,
    Tone::String,
    Tone::Escape,
    Tone::Literal,
    Tone::Constant,
    Tone::Keyword,
    Tone::Operator,
    Tone::Function,
    Tone::Type,
    Tone::Tag,
    Tone::Attribute,
    Tone::Property,
    Tone::Parameter,
    Tone::Title,
    Tone::Link,
    Tone::Inserted,
    Tone::Deleted,
];

/// The scopes each tone takes, as One Dark folds TextMate scopes. Where several match, the most
/// specific wins (`constant.character.escape` inside a `string`).
const TONE_SCOPES: &[(&str, Tone)] = &[
    ("comment", Tone::Comment),
    ("string, markup.raw", Tone::String),
    ("constant.character.escape", Tone::Escape),
    (
        "constant.numeric, constant.language, string.regexp, variable.language",
        Tone::Literal,
    ),
    (
        "constant.other, constant.character, support.constant, variable.other.constant, \
         entity.name.constant",
        Tone::Constant,
    ),
    ("keyword, storage", Tone::Keyword),
    ("keyword.operator", Tone::Operator),
    (
        "entity.name.function, support.function, variable.function",
        Tone::Function,
    ),
    (
        "entity.name.type, entity.name.class, entity.name.struct, entity.name.enum, \
         entity.name.trait, entity.name.interface, entity.other.inherited-class, support.type, \
         support.class, storage.type.primitive",
        Tone::Type,
    ),
    ("entity.name.tag", Tone::Tag),
    (
        "entity.other.attribute-name, meta.annotation, meta.decorator",
        Tone::Attribute,
    ),
    (
        "support.type.property-name, meta.mapping.key string, variable.other.member, \
         variable.other.property, entity.name.key",
        Tone::Property,
    ),
    ("variable.parameter", Tone::Parameter),
    ("markup.heading, entity.name.section", Tone::Title),
    ("markup.underline.link, string.other.link", Tone::Link),
    ("markup.inserted", Tone::Inserted),
    ("markup.deleted", Tone::Deleted),
];

/// Scopes in the text's color though a tone's scope holds them: a Markdown file's fenced code is
/// `markup.raw`, a string's tone, and its plain words keep the text's color, as in the language's
/// own file (as VS Code shows them; 2026-10-25).
const PLAIN_SCOPES: &str = "markup.raw.code-fence";

/// The text's own color, which no tone has.
const TEXT_COLOR: Color = Color {
    r: 0,
    g: 0,
    b: 0,
    a: 0xFF,
};

fn tone_color(tone: Tone) -> Color {
    let index = TONES.iter().position(|&t| t == tone).unwrap_or(0);
    Color {
        r: index as u8 + 1,
        g: 0,
        b: 0,
        a: 0xFF,
    }
}

pub(super) fn tone_of(color: Color) -> Option<Tone> {
    (color.r as usize).checked_sub(1).map(|index| TONES[index])
}

/// A theme whose colors are tones: syntect's own scope matching picks them.
fn tone_theme() -> Theme {
    Theme {
        name: None,
        author: None,
        settings: ThemeSettings {
            foreground: Some(TEXT_COLOR),
            ..ThemeSettings::default()
        },
        scopes: TONE_SCOPES
            .iter()
            .map(|&(scopes, tone)| (scopes, tone_color(tone)))
            .chain(std::iter::once((PLAIN_SCOPES, TEXT_COLOR)))
            .map(|(scopes, color)| ThemeItem {
                scope: ScopeSelectors::from_str(scopes).expect("valid scope selectors"),
                style: StyleModifier {
                    foreground: Some(color),
                    background: None,
                    font_style: None,
                },
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tone_has_its_own_color() {
        for tone in TONES {
            assert_eq!(tone_of(tone_color(tone)), Some(tone));
        }
        assert_eq!(tone_of(THEME.settings.foreground.unwrap()), None);
    }
}
