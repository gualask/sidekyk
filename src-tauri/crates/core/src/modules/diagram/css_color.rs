//! A color as a stylesheet writes it and a computed style gives it, read to its channels and its
//! opacity, and laid over another to be opaque.

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Rgb {
    r: f64,
    g: f64,
    b: f64,
}

impl Rgb {
    pub(super) const WHITE: Rgb = Rgb {
        r: 255.0,
        g: 255.0,
        b: 255.0,
    };

    pub(super) fn hex(self) -> String {
        let channel = |value: f64| value.round().clamp(0.0, 255.0) as u8;
        format!(
            "#{:02x}{:02x}{:02x}",
            channel(self.r),
            channel(self.g),
            channel(self.b)
        )
    }

    /// Whether dark text reads better on it: its relative luminance (WCAG) past the middle.
    pub(super) fn is_light(self) -> bool {
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
pub(super) struct Rgba {
    rgb: Rgb,
    alpha: f64,
}

impl Rgba {
    /// The color as it shows laid over `below`.
    pub(super) fn over(self, below: Rgb) -> Rgb {
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
pub(super) fn parse(value: &str) -> Option<Rgba> {
    let value = value.trim();
    match value.strip_prefix('#') {
        Some(hex) => parse_hex(hex),
        None => parse_rgb(value),
    }
}

/// `rgb`, `rrggbb` or `rrggbbaa`, after the `#`.
fn parse_hex(hex: &str) -> Option<Rgba> {
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
    Some(Rgba {
        rgb: Rgb {
            r: digit(0, width)?,
            g: digit(width, width)?,
            b: digit(2 * width, width)?,
        },
        alpha: alpha.unwrap_or(1.0),
    })
}

/// `rgb(r, g, b)` or `rgba(r, g, b, a)`, commas, spaces or a `/` between the numbers.
fn parse_rgb(value: &str) -> Option<Rgba> {
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
mod tests {
    use super::*;

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
}
