import { errorMessage, hasErrorCode } from '@/shared/errors/app-error';
import type { GlobalShortcutStatus } from './settings.types';
import { formatShortcut } from './shortcut-keys';

/** Why a shortcut does not work, in a sentence. */
function takenMessage(keys: string, mac: boolean): string {
    return `Another app or the system already uses ${formatShortcut(keys, mac)}. Pick another.`;
}

/** Why a shortcut registered may still not reach Sidekyk. */
function conflictMessage(keys: string, mac: boolean): string {
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
            detail: takenMessage(status.keys, mac),
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

/** Why a change to the shortcut failed: the keys it tried, taken, or the error as it reads. */
export function shortcutChangeError(error: unknown, keys: string, mac: boolean): string {
    return hasErrorCode(error, 'shortcut_taken') ? takenMessage(keys, mac) : errorMessage(error);
}
