//! What a global shortcut's combination says before the system is asked about it.

/// Its modifiers: every part but the last, the key.
fn modifiers(keys: &str) -> Vec<&str> {
    let mut parts: Vec<&str> = keys.split('+').collect();
    parts.pop();
    parts
}

/// Whether macOS may register it: since macOS 15, a hot key needs `⌘` or `⌃`, not only `⌥` and
/// `⇧`. Registering one fails with no reason given, so this is asked first.
pub(crate) fn macos_allows(keys: &str) -> bool {
    modifiers(keys)
        .iter()
        .any(|modifier| matches!(*modifier, "Super" | "Control"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_needs_command_or_control() {
        assert!(macos_allows("Control+Alt+Space"));
        assert!(macos_allows("Shift+Super+KeyK"));
        assert!(!macos_allows("Alt+Space"));
        assert!(!macos_allows("Alt+Shift+KeyK"));
        assert!(!macos_allows("F5"));
    }
}
