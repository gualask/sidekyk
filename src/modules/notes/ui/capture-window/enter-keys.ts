import type { KeyboardEvent } from 'react';
import { hasShortcutModifier } from '@/shared/platform/shortcut';

/** What `↵` is pressed with, for `enterAction`: `⇧`, the app's modifier, a mark selected. */
export function enterKeys(event: KeyboardEvent, selected: boolean) {
    return { selected, shift: event.shiftKey, mod: hasShortcutModifier(event) };
}
