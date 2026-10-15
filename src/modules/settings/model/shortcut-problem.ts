import { hasErrorCode } from '@/shared/errors/app-error';
import type { GlobalShortcutStatus, ShortcutRefusal } from './settings.types';
import { formatShortcut } from './shortcut-keys';

/** The codes a shortcut the system turned down fails with, and why. */
const REFUSALS: Record<string, ShortcutRefusal> = {
    shortcut_taken: 'taken',
    shortcut_not_allowed: 'notAllowed',
};

/** Why the system turned down the shortcut a change of the settings failed on, if it did. */
export function refusalOf(error: unknown): ShortcutRefusal | null {
    const code = Object.keys(REFUSALS).find((c) => hasErrorCode(error, c));
    return code ? REFUSALS[code] : null;
}

/** Whether a change of the settings failed on its shortcut, which the setting itself says. */
export function isShortcutError(error: unknown): boolean {
    return hasErrorCode(error, 'invalid_shortcut') || refusalOf(error) !== null;
}

/** Why a shortcut does not work, in a sentence. */
export function refusalMessage(keys: string, reason: ShortcutRefusal, mac: boolean): string {
    if (reason === 'notAllowed') {
        return `macOS allows no shortcut whose only modifiers are ⌥ and ⇧, such as ${formatShortcut(keys, mac)}. Add ⌘ or ⌃.`;
    }
    return `Another app or the system already uses ${formatShortcut(keys, mac)}. Pick another.`;
}

/** Why a shortcut registered may still not reach Sidekyk. */
export function conflictMessage(keys: string, mac: boolean): string {
    return `macOS uses ${formatShortcut(keys, mac)} for a shortcut of its own, which gets it first. Pick another, or change macOS's in System Settings › Keyboard › Keyboard Shortcuts.`;
}

/** What is wrong with the global shortcut, for the top bar's problems; null when nothing is. */
export function shortcutProblem(
    status: GlobalShortcutStatus | undefined,
    mac: boolean,
): { title: string; detail: string } | null {
    if (status?.kind === 'refused') {
        return {
            title: 'The global shortcut is off',
            detail: refusalMessage(status.keys, status.reason, mac),
        };
    }
    if (status?.kind === 'active' && status.conflict) {
        return {
            title: 'The global shortcut may not work',
            detail: conflictMessage(status.keys, mac),
        };
    }
    return null;
}
