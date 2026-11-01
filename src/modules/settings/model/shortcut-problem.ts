import { errorMessage, hasErrorCode } from '@/shared/errors/app-error';
import type { Translator } from '@/shared/i18n';
import type { GlobalShortcutStatus, ShortcutAction } from './settings.types';
import { formatShortcut } from './shortcut-keys';

/** Every global shortcut, the window's first: the settings' rows and the top bar's problems. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = ['toggle', 'capture'];

/** Why a shortcut does not work, in a sentence. */
function takenMessage(keys: string, mac: boolean, i18n: Translator): string {
    return i18n.t('shortcut.taken', { keys: formatShortcut(keys, mac) });
}

/** Why a shortcut has keys it cannot have: the other one has them. */
function inUseMessage(
    action: ShortcutAction,
    keys: string,
    mac: boolean,
    i18n: Translator,
): string {
    return i18n.t(action === 'toggle' ? 'shortcut.inUseByCapture' : 'shortcut.inUseByToggle', {
        keys: formatShortcut(keys, mac),
    });
}

/** Why a shortcut registered may still not reach Sidekyk. */
function conflictMessage(keys: string, mac: boolean, i18n: Translator): string {
    return i18n.t('shortcut.conflict', { keys: formatShortcut(keys, mac) });
}

/** What is wrong with a global shortcut, for the top bar's problems; null when nothing is. */
export function shortcutProblem(
    action: ShortcutAction,
    status: GlobalShortcutStatus | null | undefined,
    mac: boolean,
    i18n: Translator,
): { title: string; detail: string } | null {
    const off = () => i18n.t(action === 'toggle' ? 'shortcut.toggleOff' : 'shortcut.captureOff');
    if (status?.kind === 'refused') {
        return { title: off(), detail: takenMessage(status.keys, mac, i18n) };
    }
    if (status?.kind === 'inUse') {
        return { title: off(), detail: inUseMessage(action, status.keys, mac, i18n) };
    }
    if (status?.kind === 'active' && status.conflict) {
        return {
            title: i18n.t(
                action === 'toggle' ? 'shortcut.toggleMayNotWork' : 'shortcut.captureMayNotWork',
            ),
            detail: conflictMessage(status.keys, mac, i18n),
        };
    }
    return null;
}

/**
 * Why a change to a shortcut failed: the keys it tried, taken by another app or by the other
 * shortcut, or the error as it reads.
 */
export function shortcutChangeError(
    action: ShortcutAction,
    error: unknown,
    keys: string,
    mac: boolean,
    i18n: Translator,
): string {
    if (hasErrorCode(error, 'shortcut_taken')) return takenMessage(keys, mac, i18n);
    if (hasErrorCode(error, 'shortcut_in_use')) return inUseMessage(action, keys, mac, i18n);
    return errorMessage(error, i18n);
}
