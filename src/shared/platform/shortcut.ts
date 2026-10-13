import { MACOS } from './macos';

/** A shortcut with the platform's modifier, as tooltips name it: `⌘,` or `Ctrl+,`. */
export function shortcutLabel(key: string): string {
    return MACOS ? `⌘${key}` : `Ctrl+${key}`;
}

/** Whether only the platform's modifier is held among `⌘` and `Ctrl`, as a shortcut needs. */
export function hasShortcutModifier(event: KeyboardEvent): boolean {
    return MACOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
