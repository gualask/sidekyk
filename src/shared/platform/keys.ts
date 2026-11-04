import { MACOS } from './macos';

/**
 * How keys read to the user, the one place that names them (2026-11-04): macOS's symbols for
 * modifiers there, joined (`⇧⌘Z`), words joined by `+` elsewhere (`Ctrl+Shift+Z`), as each
 * system's menus write them. A combination is written as the settings store a global shortcut:
 * modifiers, then a key, joined by `+` (`Shift+Enter`, `Control+Alt+KeyC`); `Mod` is the app's
 * shortcut modifier, `⌘` on macOS and `Ctrl` elsewhere. Enter reads `↵` on macOS, the shape its
 * help gives Return; Esc, Tab and Space read as words everywhere, which a hint reads better than
 * `⎋` or `⇥`.
 */

/** The modifiers, in the order a combination shows them (macOS's: `⌃⌥⇧⌘`). */
const MODIFIERS = {
    Control: { mac: '⌃', other: 'Ctrl' },
    Alt: { mac: '⌥', other: 'Alt' },
    Shift: { mac: '⇧', other: 'Shift' },
    Super: { mac: '⌘', other: 'Win' },
} as const;

export type ModifierName = keyof typeof MODIFIERS;

const ORDER = Object.keys(MODIFIERS) as ModifierName[];

/** Keys with a name, as `KeyboardEvent.key` and `.code` call them both, and how they read. */
const NAMED_KEYS: Record<string, { mac: string; other: string }> = {
    Enter: { mac: '↵', other: 'Enter' },
    Escape: { mac: 'Esc', other: 'Esc' },
    Tab: { mac: 'Tab', other: 'Tab' },
    Space: { mac: 'Space', other: 'Space' },
    Backspace: { mac: '⌫', other: 'Backspace' },
    Delete: { mac: '⌦', other: 'Delete' },
    Home: { mac: '↖', other: 'Home' },
    End: { mac: '↘', other: 'End' },
    PageUp: { mac: '⇞', other: 'Page Up' },
    PageDown: { mac: '⇟', other: 'Page Down' },
    ArrowUp: { mac: '↑', other: '↑' },
    ArrowDown: { mac: '↓', other: '↓' },
    ArrowLeft: { mac: '←', other: '←' },
    ArrowRight: { mac: '→', other: '→' },
};

export function modifierLabel(name: ModifierName, mac = MACOS): string {
    return mac ? MODIFIERS[name].mac : MODIFIERS[name].other;
}

/** A key alone: a named one, a letter or digit by its code (`KeyK`, `Digit1`), else as it is. */
function keyLabel(key: string, mac: boolean): string {
    const named = NAMED_KEYS[key];
    if (named) return mac ? named.mac : named.other;
    const letterOrDigit = /^(?:Key|Digit)([A-Z0-9])$/.exec(key);
    return letterOrDigit ? letterOrDigit[1] : key;
}

/**
 * A combination as this system writes it: `Shift+Enter` reads `⇧↵` on macOS and `Shift+Enter`
 * elsewhere, `Mod+K` `⌘K` and `Ctrl+K`. Modifiers in their order; a part it does not know reads
 * as it is.
 */
export function keysLabel(keys: string, mac = MACOS): string {
    const parts = keys.split('+');
    const key = parts.pop() ?? '';
    const modifiers = parts
        .map((name) => (name === 'Mod' ? (mac ? 'Super' : 'Control') : name))
        .sort((a, b) => rank(a) - rank(b))
        .map((name) => (name in MODIFIERS ? modifierLabel(name as ModifierName, mac) : name));
    return [...modifiers, keyLabel(key, mac)].join(mac ? '' : '+');
}

function rank(name: string): number {
    const index = ORDER.indexOf(name as ModifierName);
    return index < 0 ? ORDER.length : index;
}

/** A tooltip with its keys after it: `Close (Esc)`. */
export function withKeys(label: string, keys: string, mac = MACOS): string {
    return `${label} (${keysLabel(keys, mac)})`;
}
