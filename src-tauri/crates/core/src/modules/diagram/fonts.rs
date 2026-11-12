//! The app's font in a diagram: its labels measured with it, and the SVG carrying it cut to the
//! characters it draws, since an SVG shown as an image loads nothing and sees none of the page's
//! fonts. Measured with another font than the one drawn, a label is cut at its box's edge. One
//! file for both, the page's own (`assets/fonts/`, its `@font-face` in `src/main.css`).

use std::sync::OnceLock;

use merman::svg::export::{NativeFontContext, NativeFontLimits};
use merman::OperationControl;
use read_fonts::collections::IntSet;
use read_fonts::types::{NameId, Tag};
use read_fonts::FontRef;
use skera::{subset_font, Plan, SubsetFlags, DEFAULT_LAYOUT_FEATURES};

use super::colors::FONT_FAMILY;

/// Plus Jakarta Sans (SIL OFL 1.1, `assets/fonts/OFL.txt`), Google Fonts' variable files
/// (`google/fonts`, `ofl/plusjakartasans`): every weight of each style.
const NORMAL: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../assets/fonts/PlusJakartaSans-wght.ttf"
));
const ITALIC: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../assets/fonts/PlusJakartaSans-Italic-wght.ttf"
));

/// The font the labels are measured with, read once.
pub(super) fn measured() -> anyhow::Result<&'static NativeFontContext> {
    static FONTS: OnceLock<Result<NativeFontContext, String>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            NativeFontContext::from_font_bytes(
                [NORMAL.to_vec(), ITALIC.to_vec()],
                NativeFontLimits::default(),
                &OperationControl::new(),
            )
            .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|error| anyhow::anyhow!("the diagrams' font does not load: {error}"))
}

/// The style a diagram carries: the font cut to the characters it draws (the italic only when it
/// draws any), and labels that overflow their box rather than being cut, for a character the font
/// lacks (`⌘`), which the webview draws from another font, wider or narrower than measured.
pub(super) fn style(svg: &str) -> anyhow::Result<String> {
    let characters = drawn_characters(svg);
    let mut faces = vec![("normal", NORMAL)];
    if svg.contains("italic") || svg.contains("<em") {
        faces.push(("italic", ITALIC));
    }
    let mut style = String::new();
    for (font_style, bytes) in faces {
        let cut = cut(bytes, &characters)?;
        style.push_str(&format!(
            "@font-face{{font-family:'{FONT_FAMILY}';font-style:{font_style};\
             font-weight:200 800;src:url(data:font/ttf;base64,{}) format('truetype');}}",
            base64(&cut)
        ));
    }
    style.push_str("foreignObject{overflow:visible}");
    Ok(style)
}

/// A font with only the glyphs of `characters` (and those its layout reaches from them), every
/// variation kept: HarfBuzz's defaults, hinting left out (the webview does not use it).
fn cut(bytes: &[u8], characters: &IntSet<u32>) -> anyhow::Result<Vec<u8>> {
    let font = FontRef::new(bytes)?;
    let mut names = IntSet::<NameId>::empty();
    names.insert_range(NameId::from(0)..=NameId::from(6));
    let mut languages = IntSet::<u16>::empty();
    languages.insert(0x0409);
    let mut scripts = IntSet::<Tag>::empty();
    scripts.invert();
    let mut features = IntSet::<Tag>::empty();
    features.extend(DEFAULT_LAYOUT_FEATURES.iter().copied());
    let plan = Plan::new(
        &IntSet::empty(),
        characters,
        &font,
        SubsetFlags::SUBSET_FLAGS_NO_HINTING,
        &IntSet::empty(),
        &scripts,
        &features,
        &names,
        &languages,
    );
    subset_font(&font, &plan).map_err(|error| anyhow::anyhow!("the diagram's font: {error}"))
}

/// The characters an SVG draws: its text, outside `<style>`, with its entities read.
fn drawn_characters(svg: &str) -> IntSet<u32> {
    let mut characters = IntSet::empty();
    let mut rest = svg;
    while !rest.is_empty() {
        let text_end = rest.find('<').unwrap_or(rest.len());
        add_text(&rest[..text_end], &mut characters);
        rest = &rest[text_end..];
        if rest.starts_with("<style") {
            rest = &rest[rest.find("</style>").unwrap_or(rest.len())..];
        }
        rest = &rest[rest.find('>').map_or(rest.len(), |at| at + 1)..];
    }
    characters
}

/// The characters of a text between tags: `&amp;`, `&#38;`, `&#x26;` read as `&`.
fn add_text(text: &str, characters: &mut IntSet<u32>) {
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        characters.extend(rest[..at].chars().map(u32::from));
        let entity = &rest[at + 1..];
        let end = entity.find(';').filter(|&end| end <= 10);
        let character = end.and_then(|end| entity_character(&entity[..end]));
        match (character, end) {
            (Some(character), Some(end)) => {
                characters.insert(u32::from(character));
                rest = &entity[end + 1..];
            }
            _ => {
                characters.insert(u32::from('&'));
                rest = entity;
            }
        }
    }
    characters.extend(rest.chars().map(u32::from));
}

/// The character an entity names, between its `&` and its `;`: one of XML's, `nbsp`, or a number.
fn entity_character(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some('\u{a0}'),
        number => number
            .strip_prefix("#x")
            .or_else(|| number.strip_prefix("#X"))
            .map(|hex| u32::from_str_radix(hex, 16))
            .or_else(|| number.strip_prefix('#').map(str::parse::<u32>))
            .and_then(Result::ok)
            .and_then(char::from_u32),
    }
}

/// Standard base64, padded.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = chunk.iter().enumerate().fold(0u32, |acc, (index, &byte)| {
            acc | u32::from(byte) << (16 - 8 * index)
        });
        // a chunk of n bytes fills n + 1 characters, `=` the rest
        let filled = chunk.len() + 1;
        out.extend(
            (0..filled)
                .map(|index| char::from(ALPHABET[(triple >> (18 - 6 * index)) as usize & 63])),
        );
        out.extend(std::iter::repeat_n('=', 4 - filled));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(characters: &IntSet<u32>) -> String {
        characters.iter().filter_map(char::from_u32).collect()
    }

    #[test]
    fn base64_is_the_standard_padded_one() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
    }

    #[test]
    fn the_characters_drawn_are_the_texts_not_the_style_nor_the_tags() {
        let svg = "<svg id=\"z\"><style>#q{fill:red}</style><g><text>ab&amp;c</text>\
                   <foreignObject><div>é &#8984;W &#x41; &bogus x</div></foreignObject></g></svg>";
        assert_eq!(text(&drawn_characters(svg)), " &AWabcgosuxé⌘");
    }

    #[test]
    fn the_style_carries_the_font_cut_to_the_text() {
        assert!(measured().is_ok());
        let normal = style("<svg><text>Agent</text></svg>").unwrap();
        assert_eq!(normal.matches("@font-face").count(), 1);
        assert!(normal.contains("font-style:normal"));
        assert!(normal.ends_with("foreignObject{overflow:visible}"));
        // a few glyphs of the 176 KB file
        assert!(normal.len() < 30_000, "{}", normal.len());
        let italic = style("<svg><em>Agent</em></svg>").unwrap();
        assert!(italic.contains("font-style:italic"));
    }
}
