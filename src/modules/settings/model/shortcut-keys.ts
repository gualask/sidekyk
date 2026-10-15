/**
 * A global shortcut's combination, in the form the backend registers (`global-hotkey`'s parser):
 * modifiers in a fixed order, then the key's `KeyboardEvent.code`, joined by `+`, such as
 * `Control+Alt+Space` or `Super+Shift+KeyK`. The code names the key by its place on the
 * keyboard, so `⌥` on macOS, which changes the character typed, does not change it.
 */

/** The modifiers, in the order the combination and macOS's symbols list them. */
const MODIFIERS = [
    { name: 'Control', held: (e: KeyboardEventLike) => e.ctrlKey, mac: '⌃', other: 'Ctrl' },
    { name: 'Alt', held: (e: KeyboardEventLike) => e.altKey, mac: '⌥', other: 'Alt' },
    { name: 'Shift', held: (e: KeyboardEventLike) => e.shiftKey, mac: '⇧', other: 'Shift' },
    { name: 'Super', held: (e: KeyboardEventLike) => e.metaKey, mac: '⌘', other: 'Win' },
] as const;

/** Named keys a shortcut may end with, and how they read on macOS and elsewhere. */
const NAMED_KEYS: Record<string, { mac: string; other: string }> = {
    Space: { mac: 'Space', other: 'Space' },
    Enter: { mac: '↩', other: 'Enter' },
    Tab: { mac: '⇥', other: 'Tab' },
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

/** The parts of a `KeyboardEvent` a combination is read from. */
export interface KeyboardEventLike {
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

/**
 * How a key a shortcut may end with reads, or null for one it may not: letters, digits, F1 to
 * F20 and the named keys. Punctuation is left out: its code names the US layout's character,
 * which another layout prints elsewhere.
 */
function keyLabel(code: string, mac: boolean): string | null {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1];
    const digit = /^Digit([0-9])$/.exec(code);
    if (digit) return digit[1];
    if (/^F([1-9]|1[0-9]|20)$/.test(code)) return code;
    const named = NAMED_KEYS[code];
    if (!named) return null;
    return mac ? named.mac : named.other;
}

/**
 * The combination a key press makes, or null while it is not one: only modifiers held so far, a
 * key a shortcut may not end with, or no `Ctrl`, `⌥`/`Alt` or `⌘`/`Win` (with `⇧` alone, a
 * shortcut would take a character from every app).
 */
export function shortcutFromEvent(event: KeyboardEventLike): string | null {
    if (keyLabel(event.code, false) === null) return null;
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
    const held = MODIFIERS.filter((modifier) => modifier.held(event)).map((m) => m.name);
    return [...held, event.code].join('+');
}

/** Whether the key pressed is itself a modifier: a combination is still being held. */
function isModifierKey(code: string): boolean {
    return /^(Shift|Control|Alt|Meta|OS)(Left|Right)$/.test(code) || code === 'CapsLock';
}

/** What a key press lacks to make a shortcut, when it is not one and not a modifier. */
export type ShortcutHint = 'needsModifier' | 'unsupportedKey';

export function shortcutHint(event: KeyboardEventLike): ShortcutHint | null {
    if (isModifierKey(event.code) || shortcutFromEvent(event)) return null;
    if (keyLabel(event.code, false) === null) return 'unsupportedKey';
    return 'needsModifier';
}

/** The modifiers held, as the platform writes them before a key: `⌃⌥`, or `Ctrl+Alt+`. */
export function heldModifiers(event: KeyboardEventLike, mac: boolean): string {
    const held = MODIFIERS.filter((modifier) => modifier.held(event));
    if (mac) return held.map((modifier) => modifier.mac).join('');
    return held.map((modifier) => `${modifier.other}+`).join('');
}

/**
 * A combination as the platform writes it: `⌃⌥Space` on macOS, `Ctrl+Alt+Space` elsewhere. A
 * part it does not know reads as it is.
 */
export function formatShortcut(keys: string, mac: boolean): string {
    const parts = keys.split('+');
    const key = parts.at(-1) ?? '';
    const modifiers = parts
        .slice(0, -1)
        .map((name) => MODIFIERS.find((m) => m.name === name))
        .map((modifier, i) => (modifier ? (mac ? modifier.mac : modifier.other) : parts[i]));
    const label = keyLabel(key, mac) ?? key;
    return mac ? [...modifiers, label].join('') : [...modifiers, label].join('+');
}
