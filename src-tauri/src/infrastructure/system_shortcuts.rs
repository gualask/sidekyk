//! The keyboard shortcuts macOS keeps for itself (Spotlight, input sources, Mission Control…), the
//! ones System Settings › Keyboard › Keyboard Shortcuts lists. A global shortcut on the same keys
//! registers without an error, but macOS gets them first.

use std::ffi::{c_char, c_void, CStr};

use crate::modules::settings::ShortcutKeys;

type CFTypeRef = *const c_void;
type CFIndex = isize;

/// `kCFNumberSInt64Type`.
const SINT64: CFIndex = 4;
/// `kCFStringEncodingUTF8`.
const UTF8: u32 = 0x0800_0100;

/// The keys of a symbolic hot key's dictionary. The SDK's headers no longer declare them: they
/// were `CFSTR` macros of their own names.
const CODE_KEY: &CStr = c"kHISymbolicHotKeyCode";
const MODIFIERS_KEY: &CStr = c"kHISymbolicHotKeyModifiers";
const ENABLED_KEY: &CStr = c"kHISymbolicHotKeyEnabled";

/// Carbon's modifier bits, as the symbolic hot keys report them.
const CMD: i64 = 1 << 8;
const SHIFT: i64 = 1 << 9;
const OPTION: i64 = 1 << 11;
const CONTROL: i64 = 1 << 12;

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn CopySymbolicHotKeys(hot_keys: *mut CFTypeRef) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CFTypeRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, index: CFIndex) -> CFTypeRef;
    fn CFDictionaryGetValue(dictionary: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFNumberGetValue(number: CFTypeRef, kind: CFIndex, value: *mut c_void) -> u8;
    fn CFBooleanGetValue(boolean: CFTypeRef) -> u8;
    fn CFStringCreateWithCString(
        allocator: CFTypeRef,
        string: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
    fn CFRelease(value: CFTypeRef);
}

/// Whether one of macOS's own shortcuts, turned on, uses these keys.
pub(crate) fn system_uses(keys: &ShortcutKeys) -> bool {
    let Some(wanted) = carbon_hot_key(keys.as_str()) else {
        return false;
    };
    // SAFETY: every object created or copied here is released before returning; values are
    // read through CoreFoundation's getters and checked for null first.
    unsafe {
        let keys = [CODE_KEY, MODIFIERS_KEY, ENABLED_KEY]
            .map(|key| CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), UTF8));
        let mut hot_keys: CFTypeRef = std::ptr::null();
        let found = !keys.iter().any(|key| key.is_null())
            && CopySymbolicHotKeys(&mut hot_keys) == 0
            && !hot_keys.is_null()
            && (0..CFArrayGetCount(hot_keys)).any(|i| {
                let [code_key, modifiers_key, enabled_key] = keys;
                let hot_key = CFArrayGetValueAtIndex(hot_keys, i);
                let enabled = CFDictionaryGetValue(hot_key, enabled_key);
                if enabled.is_null() || CFBooleanGetValue(enabled) == 0 {
                    return false;
                }
                let (Some(code), Some(modifiers)) = (
                    number(CFDictionaryGetValue(hot_key, code_key)),
                    number(CFDictionaryGetValue(hot_key, modifiers_key)),
                ) else {
                    return false;
                };
                (code, modifiers & (CMD | SHIFT | OPTION | CONTROL)) == wanted
            });
        if !hot_keys.is_null() {
            CFRelease(hot_keys);
        }
        for key in keys.into_iter().filter(|key| !key.is_null()) {
            CFRelease(key);
        }
        found
    }
}

/// A `CFNumber`'s value.
///
/// # Safety
/// `value` is null or a `CFNumber`.
unsafe fn number(value: CFTypeRef) -> Option<i64> {
    if value.is_null() {
        return None;
    }
    let mut out: i64 = 0;
    let read = CFNumberGetValue(value, SINT64, (&mut out as *mut i64).cast());
    (read != 0).then_some(out)
}

/// The keys as Carbon names them: the virtual key code and the modifier bits. Every
/// `ShortcutKeys` has a name (see the tests).
fn carbon_hot_key(keys: &str) -> Option<(i64, i64)> {
    let mut parts: Vec<&str> = keys.split('+').collect();
    let code = virtual_key(parts.pop()?)?;
    let mut modifiers = 0;
    for part in parts {
        modifiers |= match part {
            "Control" => CONTROL,
            "Alt" => OPTION,
            "Shift" => SHIFT,
            "Super" => CMD,
            _ => return None,
        };
    }
    Some((code, modifiers))
}

/// The virtual key code (`kVK_*`) of a key a shortcut may end with
/// (`modules/settings/shortcut_keys.rs`).
fn virtual_key(code: &str) -> Option<i64> {
    Some(match code {
        "KeyA" => 0x00,
        "KeyS" => 0x01,
        "KeyD" => 0x02,
        "KeyF" => 0x03,
        "KeyH" => 0x04,
        "KeyG" => 0x05,
        "KeyZ" => 0x06,
        "KeyX" => 0x07,
        "KeyC" => 0x08,
        "KeyV" => 0x09,
        "KeyB" => 0x0B,
        "KeyQ" => 0x0C,
        "KeyW" => 0x0D,
        "KeyE" => 0x0E,
        "KeyR" => 0x0F,
        "KeyY" => 0x10,
        "KeyT" => 0x11,
        "Digit1" => 0x12,
        "Digit2" => 0x13,
        "Digit3" => 0x14,
        "Digit4" => 0x15,
        "Digit6" => 0x16,
        "Digit5" => 0x17,
        "Digit9" => 0x19,
        "Digit7" => 0x1A,
        "Digit8" => 0x1C,
        "Digit0" => 0x1D,
        "KeyO" => 0x1F,
        "KeyU" => 0x20,
        "KeyI" => 0x22,
        "KeyP" => 0x23,
        "Enter" => 0x24,
        "KeyL" => 0x25,
        "KeyJ" => 0x26,
        "KeyK" => 0x28,
        "KeyN" => 0x2D,
        "KeyM" => 0x2E,
        "Tab" => 0x30,
        "Space" => 0x31,
        "Backspace" => 0x33,
        "F17" => 0x40,
        "F18" => 0x4F,
        "F19" => 0x50,
        "F20" => 0x5A,
        "F5" => 0x60,
        "F6" => 0x61,
        "F7" => 0x62,
        "F3" => 0x63,
        "F8" => 0x64,
        "F9" => 0x65,
        "F11" => 0x67,
        "F13" => 0x69,
        "F16" => 0x6A,
        "F14" => 0x6B,
        "F10" => 0x6D,
        "F12" => 0x6F,
        "F15" => 0x71,
        "Home" => 0x73,
        "PageUp" => 0x74,
        "Delete" => 0x75,
        "F4" => 0x76,
        "End" => 0x77,
        "F2" => 0x78,
        "PageDown" => 0x79,
        "F1" => 0x7A,
        "ArrowLeft" => 0x7B,
        "ArrowRight" => 0x7C,
        "ArrowDown" => 0x7D,
        "ArrowUp" => 0x7E,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_read_as_carbon_names_them() {
        assert_eq!(carbon_hot_key("Super+Space"), Some((0x31, CMD)));
        assert_eq!(
            carbon_hot_key("Control+Alt+Shift+KeyK"),
            Some((0x28, CONTROL | OPTION | SHIFT))
        );
        assert_eq!(carbon_hot_key("Hyper+Space"), None);
        assert_eq!(carbon_hot_key("Control+Backquote"), None);
    }

    #[test]
    fn every_key_and_modifier_of_a_shortcut_has_a_carbon_name() {
        use crate::modules::settings::shortcut_keys::{KEYS, MODIFIERS};
        for key in KEYS {
            assert!(virtual_key(key).is_some(), "{key}");
        }
        let all = format!("{}+Space", MODIFIERS.join("+"));
        assert!(carbon_hot_key(&all).is_some());
    }

    #[test]
    fn reading_the_system_shortcuts_does_not_fail() {
        // which ones are on depends on the machine: this only reads them
        let keys = |k: &str| ShortcutKeys::parse(k).unwrap();
        let _ = system_uses(&keys("Super+Space"));
        assert!(!system_uses(&keys("Control+Alt+Shift+Super+F20")));
    }
}
