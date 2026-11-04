import type { Translator } from '@/shared/i18n';
import { keysLabel, type ModifierName, modifierLabel } from '@/shared/platform/keys';

/**
 * A global shortcut's combination, in the form the settings store it: modifiers in a fixed order,
 * then the key's `KeyboardEvent.code`, joined by `+`, such as `Control+Alt+Space` or
 * `Super+Shift+KeyK`. The code names the key by its place on the keyboard, so `⌥` on macOS,
 * which changes the character typed, does not change it. The backend checks the same rule
 * (`src-tauri/crates/core/src/modules/settings/shortcut_keys.rs`) and has the last word.
 */

/** The modifiers, in the order a combination lists them (as `shared/platform/keys.ts` reads it). */
const MODIFIERS = [
    { name: 'Control', held: (e: KeyboardEventLike) => e.ctrlKey },
    { name: 'Alt', held: (e: KeyboardEventLike) => e.altKey },
    { name: 'Shift', held: (e: KeyboardEventLike) => e.shiftKey },
    { name: 'Super', held: (e: KeyboardEventLike) => e.metaKey },
] as const satisfies readonly { name: ModifierName; held: unknown }[];

type Modifier = (typeof MODIFIERS)[number];

/** The modifiers one of which a shortcut needs, unless it ends with a function key. */
const TAKES_NO_CHARACTER: readonly Modifier['name'][] = ['Control', 'Alt', 'Super'];

/** Named keys a shortcut may end with; not `Escape`, which cancels typing one. */
const NAMED_KEYS: readonly string[] = [
    'Space',
    'Enter',
    'Tab',
    'Backspace',
    'Delete',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
];

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
 * Whether a shortcut may end with a key: letters, digits, function keys and the named keys.
 * Punctuation is left out: its code names the US layout's character, which another layout prints
 * elsewhere.
 */
function isShortcutKey(code: string): boolean {
    return (
        /^(?:Key[A-Z]|Digit[0-9])$/.test(code) || isFunctionKey(code) || NAMED_KEYS.includes(code)
    );
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
    if (!isShortcutKey(event.code)) return null;
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
    if (!isShortcutKey(event.code)) return 'unsupportedKey';
    return 'needsModifier';
}

/** A combination being typed, its key still to come: `⌃⌥…`, `Ctrl+Alt+…`; null with none held. */
export function pendingShortcut(event: KeyboardEventLike, mac: boolean): string | null {
    const held = MODIFIERS.filter((modifier) => modifier.held(event));
    if (held.length === 0) return null;
    return keysLabel([...held.map((modifier) => modifier.name), '…'].join('+'), mac);
}

/** The modifiers one of which a shortcut needs, as a sentence names them: `⌃, ⌥ or ⌘`. */
export function neededModifiers(mac: boolean, i18n: Translator): string {
    const labels = MODIFIERS.filter((modifier) => TAKES_NO_CHARACTER.includes(modifier.name)).map(
        (modifier) => modifierLabel(modifier.name, mac),
    );
    return i18n.t('shortcut.either', {
        some: labels.slice(0, -1).join(', '),
        last: labels.at(-1) ?? '',
    });
}
