//! A project's avatar: a color of its own and, if the user wrote them, its letters
//! (`docs/features/projects.md`, Avatar).

use serde::{Deserialize, Serialize};

/// How many avatar colors there are: `--ui-avatar-1` to `--ui-avatar-10` in the frontend's theme
/// (`AVATAR_COLORS` in `src/shared/projects/avatar.ts`).
const AVATAR_COLORS: u8 = 10;
/// The most letters an avatar holds: two fit wherever it shows, the palette's row included.
const MAX_LETTERS: usize = 2;

/// One of the avatar colors, 1 to `AVATAR_COLORS`, as the frontend's tokens number them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct AvatarColor(u8);

impl AvatarColor {
    pub const FIRST: Self = Self(1);

    /// The color used by the fewest of `used`, the first of them on a tie: a new project's, so
    /// no two projects share one while there are colors left.
    pub fn least_used(used: impl IntoIterator<Item = Self>) -> Self {
        let mut counts = [0usize; AVATAR_COLORS as usize];
        for color in used {
            counts[usize::from(color.0 - 1)] += 1;
        }
        let fewest = (0..counts.len()).min_by_key(|&i| counts[i]).unwrap_or(0);
        Self(fewest as u8 + 1)
    }
}

impl TryFrom<u8> for AvatarColor {
    type Error = &'static str;

    fn try_from(number: u8) -> Result<Self, Self::Error> {
        if (1..=AVATAR_COLORS).contains(&number) {
            Ok(Self(number))
        } else {
            Err("no avatar color of that number")
        }
    }
}

impl From<AvatarColor> for u8 {
    fn from(color: AvatarColor) -> Self {
        color.0
    }
}

/// A project's avatar: its color, and the letters the user wrote; none, the frontend's from the
/// name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Avatar {
    pub color: AvatarColor,
    pub letters: Option<String>,
}

impl Avatar {
    /// An avatar of this color, its letters from the name.
    pub fn of_color(color: AvatarColor) -> Self {
        Self {
            color,
            letters: None,
        }
    }

    /// The avatar as given, its letters trimmed, none when blank; refused when they are more than
    /// two or not letters and digits (the dialog never sends them).
    pub fn checked(self) -> anyhow::Result<Self> {
        let letters = match self.letters.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(letters) => {
                anyhow::ensure!(valid_letters(letters), "avatar letters: {letters:?}");
                Some(letters.to_string())
            }
        };
        Ok(Self { letters, ..self })
    }
}

/// One or two letters or digits, as the frontend's `validLetters`.
pub(super) fn valid_letters(letters: &str) -> bool {
    let count = letters.chars().count();
    (1..=MAX_LETTERS).contains(&count) && letters.chars().all(char::is_alphanumeric)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn color(number: u8) -> AvatarColor {
        AvatarColor::try_from(number).unwrap()
    }

    #[test]
    fn a_new_color_is_the_least_used_the_first_on_a_tie() {
        assert_eq!(AvatarColor::least_used([]), color(1));
        assert_eq!(AvatarColor::least_used([color(1), color(3)]), color(2));
        let every: Vec<_> = (1..=AVATAR_COLORS).map(color).collect();
        assert_eq!(AvatarColor::least_used(every.clone()), color(1));
        let again = every.into_iter().chain([color(1), color(2)]);
        assert_eq!(AvatarColor::least_used(again), color(3));
    }

    #[test]
    fn a_color_is_one_of_the_theme_s() {
        assert!(AvatarColor::try_from(0).is_err());
        assert!(AvatarColor::try_from(AVATAR_COLORS + 1).is_err());
        assert_eq!(serde_json::to_value(color(10)).unwrap(), 10);
        assert!(serde_json::from_value::<AvatarColor>(serde_json::json!(11)).is_err());
    }

    #[test]
    fn letters_are_one_or_two_letters_or_digits_trimmed() {
        let with = |letters: &str| Avatar {
            color: AvatarColor::FIRST,
            letters: Some(letters.into()),
        };
        assert_eq!(
            with(" sw ").checked().unwrap().letters.as_deref(),
            Some("sw")
        );
        assert_eq!(with("É2").checked().unwrap().letters.as_deref(), Some("É2"));
        assert_eq!(with("  ").checked().unwrap().letters, None);
        assert!(with("abc").checked().is_err());
        assert!(with("a-").checked().is_err());
        assert!(with("🙂").checked().is_err());
    }
}
