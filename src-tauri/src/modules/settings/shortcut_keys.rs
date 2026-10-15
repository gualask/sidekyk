//! A global shortcut's combination, as the settings store it: modifiers in a fixed order, then
//! the key's `KeyboardEvent.code`, joined by `+`, such as `Control+Alt+Space`. The frontend
//! records it with the same grammar (`src/modules/settings/model/shortcut-keys.ts`); this is the
//! rule that decides.

/// The modifiers, in the order a combination lists them.
pub(crate) const MODIFIERS: [&str; 4] = ["Control", "Alt", "Shift", "Super"];

/// The keys a shortcut may end with: letters, digits, function keys and named keys. Punctuation
/// is left out: its code names the US layout's key, which another layout prints elsewhere.
pub(crate) const KEYS: [&str; 69] = [
    "KeyA",
    "KeyB",
    "KeyC",
    "KeyD",
    "KeyE",
    "KeyF",
    "KeyG",
    "KeyH",
    "KeyI",
    "KeyJ",
    "KeyK",
    "KeyL",
    "KeyM",
    "KeyN",
    "KeyO",
    "KeyP",
    "KeyQ",
    "KeyR",
    "KeyS",
    "KeyT",
    "KeyU",
    "KeyV",
    "KeyW",
    "KeyX",
    "KeyY",
    "KeyZ",
    "Digit0",
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12",
    "F13",
    "F14",
    "F15",
    "F16",
    "F17",
    "F18",
    "F19",
    "F20",
    "Space",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
];

/// A combination a global shortcut may be.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShortcutKeys(String);

impl ShortcutKeys {
    /// The combination `keys` names, or None when a shortcut may not be it: a modifier unknown,
    /// repeated or out of order, a key not in `KEYS`, or no `Control`, `Alt` or `Super` with a
    /// key other than a function key, which would take a character from every app.
    pub(crate) fn parse(keys: &str) -> Option<Self> {
        let mut parts: Vec<&str> = keys.split('+').collect();
        let key = parts.pop()?;
        if !KEYS.contains(&key) {
            return None;
        }
        let mut order = Vec::with_capacity(parts.len());
        for part in &parts {
            order.push(MODIFIERS.iter().position(|modifier| modifier == part)?);
        }
        if !order.windows(2).all(|pair| pair[0] < pair[1]) {
            return None;
        }
        let takes_no_character = parts
            .iter()
            .any(|modifier| matches!(*modifier, "Control" | "Alt" | "Super"));
        if !takes_no_character && !is_function_key(key) {
            return None;
        }
        Some(Self(keys.to_string()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

fn is_function_key(key: &str) -> bool {
    key.strip_prefix('F')
        .is_some_and(|number| number.parse::<u8>().is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modifiers_in_order_then_a_key() {
        for keys in [
            "Control+Alt+Space",
            "Shift+Super+KeyK",
            "Alt+Space",
            "Super+F5",
        ] {
            assert_eq!(ShortcutKeys::parse(keys).unwrap().as_str(), keys);
        }
    }

    #[test]
    fn a_function_key_may_come_alone_or_with_shift() {
        assert!(ShortcutKeys::parse("F13").is_some());
        assert!(ShortcutKeys::parse("Shift+F5").is_some());
    }

    #[test]
    fn any_other_key_needs_control_alt_or_super() {
        assert!(ShortcutKeys::parse("KeyA").is_none());
        assert!(ShortcutKeys::parse("Shift+KeyA").is_none());
        assert!(ShortcutKeys::parse("Space").is_none());
    }

    #[test]
    fn modifiers_known_once_in_order() {
        assert!(ShortcutKeys::parse("Alt+Control+Space").is_none());
        assert!(ShortcutKeys::parse("Control+Control+Space").is_none());
        assert!(ShortcutKeys::parse("Hyper+Space").is_none());
    }

    #[test]
    fn only_the_keys_listed() {
        assert!(ShortcutKeys::parse("Control+Backquote").is_none());
        assert!(ShortcutKeys::parse("Control+F21").is_none());
        assert!(ShortcutKeys::parse("Control+").is_none());
        assert!(ShortcutKeys::parse("").is_none());
    }
}
