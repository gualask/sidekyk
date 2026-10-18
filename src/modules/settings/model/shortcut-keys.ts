/**
 * A global shortcut's combination, in the form the settings store it: modifiers in a fixed order,
 * then the key's `KeyboardEvent.code`, joined by `+`, such as `Control+Alt+Space` or
 * `Super+Shift+KeyK`. The code names the key by its place on the keyboard, so `⌥` on macOS,
 * which changes the character typed, does not change it. The backend checks the same rule
 * (`src-tauri/crates/core/src/modules/settings/shortcut_keys.rs`) and has the last word.
 */

/** The modifiers, in the order a combination lists them, and how each platform writes them. */
const MODIFIERS = [
    { name: 'Control', held: (e: KeyboardEventLike) => e.ctrlKey, mac: '⌃', other: 'Ctrl' },
    { name: 'Alt', held: (e: KeyboardEventLike) => e.altKey, mac: '⌥', other: 'Alt' },
    { name: 'Shift', held: (e: KeyboardEventLike) => e.shiftKey, mac: '⇧', other: 'Shift' },
    { name: 'Super', held: (e: KeyboardEventLike) => e.metaKey, mac: '⌘', other: 'Win' },
] as const;

type Modifier = (typeof MODIFIERS)[number];

/** The modifiers one of which a shortcut needs, unless it ends with a function key. */
const TAKES_NO_CHARACTER: readonly Modifier['name'][] = ['Control', 'Alt', 'Super'];

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

/** F1 to F20: they take no character from any app, so a shortcut may be one alone. */
function isFunctionKey(code: string): boolean {
    return /^F([1-9]|1[0-9]|20)$/.test(code);
}

/**
 * How a key a shortcut may end with reads, or null for one it may not: letters, digits, function
 * keys and the named keys. Punctuation is left out: its code names the US layout's character,
 * which another layout prints elsewhere.
 */
function keyLabel(code: string, mac: boolean): string | null {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1];
    const digit = /^Digit([0-9])$/.exec(code);
    if (digit) return digit[1];
    if (isFunctionKey(code)) return code;
    const named = NAMED_KEYS[code];
    if (!named) return null;
    return mac ? named.mac : named.other;
}

function modifierLabel(modifier: Modifier, mac: boolean): string {
    return mac ? modifier.mac : modifier.other;
}

/** Parts as the platform joins them: `⌃⌥Space` on macOS, `Ctrl+Alt+Space` elsewhere. */
function joinParts(parts: string[], mac: boolean): string {
    return parts.join(mac ? '' : '+');
}

/** Whether the key pressed is itself a modifier: a combination is still being held. */
function isModifierKey(code: string): boolean {
    return /^(Shift|Control|Alt|Meta|OS)(Left|Right)$/.test(code) || code === 'CapsLock';
}

/**
 * The combination a key press makes, or null while it is not one: only modifiers held so far, a
 * key a shortcut may not end with, or a key other than a function key without `Ctrl`, `⌥`/`Alt`
 * or `⌘`/`Win` (with `⇧` alone, it would take a character from every app).
 */
export function shortcutFromEvent(event: KeyboardEventLike): string | null {
    if (keyLabel(event.code, false) === null) return null;
    const held = MODIFIERS.filter((modifier) => modifier.held(event));
    const needsNone = isFunctionKey(event.code);
    if (!needsNone && !held.some((modifier) => TAKES_NO_CHARACTER.includes(modifier.name))) {
        return null;
    }
    return [...held.map((modifier) => modifier.name), event.code].join('+');
}

/** What a key press lacks to make a shortcut, when it is not one and not a modifier. */
export type ShortcutHint = 'needsModifier' | 'unsupportedKey';

export function shortcutHint(event: KeyboardEventLike): ShortcutHint | null {
    if (isModifierKey(event.code) || shortcutFromEvent(event)) return null;
    if (keyLabel(event.code, false) === null) return 'unsupportedKey';
    return 'needsModifier';
}

/** A combination being typed, its key still to come: `⌃⌥…`, `Ctrl+Alt+…`; null with none held. */
export function pendingShortcut(event: KeyboardEventLike, mac: boolean): string | null {
    const held = MODIFIERS.filter((modifier) => modifier.held(event));
    if (held.length === 0) return null;
    return joinParts([...held.map((modifier) => modifierLabel(modifier, mac)), '…'], mac);
}

/** The modifiers one of which a shortcut needs, as a sentence names them: `⌃, ⌥ or ⌘`. */
export function neededModifiers(mac: boolean): string {
    const labels = MODIFIERS.filter((modifier) => TAKES_NO_CHARACTER.includes(modifier.name)).map(
        (modifier) => modifierLabel(modifier, mac),
    );
    return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
}

/**
 * A combination as the platform writes it: `⌃⌥Space` on macOS, `Ctrl+Alt+Space` elsewhere. A
 * part it does not know reads as it is.
 */
export function formatShortcut(keys: string, mac: boolean): string {
    const parts = keys.split('+');
    const key = parts.pop() ?? '';
    const modifiers = parts.map((name) => {
        const modifier = MODIFIERS.find((m) => m.name === name);
        return modifier ? modifierLabel(modifier, mac) : name;
    });
    return joinParts([...modifiers, keyLabel(key, mac) ?? key], mac);
}
