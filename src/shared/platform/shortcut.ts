import { MACOS } from './macos';

/** The `KeyboardEvent.key` of the platform's shortcut modifier. */
export const SHORTCUT_MODIFIER = MACOS ? 'Meta' : 'Control';

/** A shortcut with the platform's modifier, as tooltips name it: `⌘,` or `Ctrl+,`. */
export function shortcutLabel(key: string): string {
    return MACOS ? `⌘${key}` : `Ctrl+${key}`;
}

/** A key with `⌥` (`Alt`), as tooltips name it: `⌥↑` or `Alt+↑`. */
export function altLabel(key: string): string {
    return MACOS ? `⌥${key}` : `Alt+${key}`;
}

/** Whether only the platform's modifier is held among `⌘` and `Ctrl`, as a shortcut needs. */
export function hasShortcutModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
    return MACOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/**
 * The key of a shortcut made with the platform's modifier and no `⌥` (`Alt`), lowercased, as
 * shortcuts are named (`k` for `⌘K`); null for any other key.
 */
export function shortcutKey(event: {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    key: string;
}): string | null {
    return hasShortcutModifier(event) && !event.altKey ? event.key.toLowerCase() : null;
}
