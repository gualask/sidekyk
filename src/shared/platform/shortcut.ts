import { MACOS } from './macos';

/** The `KeyboardEvent.key` of the platform's shortcut modifier. */
export const SHORTCUT_MODIFIER = MACOS ? 'Meta' : 'Control';

/** A shortcut with the platform's modifier, as tooltips name it: `⌘,` or `Ctrl+,`. */
export function shortcutLabel(key: string): string {
    return MACOS ? `⌘${key}` : `Ctrl+${key}`;
}

/** Whether only the platform's modifier is held among `⌘` and `Ctrl`, as a shortcut needs. */
export function hasShortcutModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
    return MACOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
