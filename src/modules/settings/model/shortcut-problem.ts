import { errorMessage, hasErrorCode } from '@/shared/errors/app-error';
import type { Translator } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';
import { SHORTCUT_ACTIONS } from './global-shortcuts';
import type { GlobalShortcutStatuses, ShortcutAction } from './settings.types';

/** A shortcut that does not work, by what it does. */
const OFF = {
    toggle: 'shortcut.toggleOff',
    capture: 'shortcut.captureOff',
    note: 'shortcut.noteOff',
} as const satisfies Record<ShortcutAction, string>;

/** A shortcut macOS may get first, by what it does. */
const MAY_NOT_WORK = {
    toggle: 'shortcut.toggleMayNotWork',
    capture: 'shortcut.captureMayNotWork',
    note: 'shortcut.noteMayNotWork',
} as const satisfies Record<ShortcutAction, string>;

/** Keys another shortcut has, by what that one does. */
const IN_USE_BY = {
    toggle: 'shortcut.inUseByToggle',
    capture: 'shortcut.inUseByCapture',
    note: 'shortcut.inUseByNote',
} as const satisfies Record<ShortcutAction, string>;

/** Why a shortcut does not work, in a sentence. */
function takenMessage(keys: string, mac: boolean, i18n: Translator): string {
    return i18n.t('shortcut.taken', { keys: keysLabel(keys, mac) });
}

/**
 * Why a shortcut has keys it cannot have: another one registered them, which the statuses tell
 * (the backend refuses keys another holds as registered).
 */
function inUseMessage(
    action: ShortcutAction,
    keys: string,
    statuses: GlobalShortcutStatuses | undefined,
    mac: boolean,
    i18n: Translator,
): string {
    const holder = SHORTCUT_ACTIONS.find((other) => {
        const status = statuses?.[other];
        return other !== action && status?.kind === 'active' && status.keys === keys;
    });
    const shown = { keys: keysLabel(keys, mac) };
    return holder ? i18n.t(IN_USE_BY[holder], shown) : i18n.t('shortcut.inUse', shown);
}

/** What is wrong with a global shortcut, for the top bar's problems; null when nothing is. */
export function shortcutProblem(
    action: ShortcutAction,
    statuses: GlobalShortcutStatuses | undefined,
    mac: boolean,
    i18n: Translator,
): { title: string; detail: string } | null {
    const status = statuses?.[action];
    if (status?.kind === 'refused') {
        return { title: i18n.t(OFF[action]), detail: takenMessage(status.keys, mac, i18n) };
    }
    if (status?.kind === 'inUse') {
        return {
            title: i18n.t(OFF[action]),
            detail: inUseMessage(action, status.keys, statuses, mac, i18n),
        };
    }
    if (status?.kind === 'active' && status.conflict) {
        // registered, but macOS may get the keys first
        return {
            title: i18n.t(MAY_NOT_WORK[action]),
            detail: i18n.t('shortcut.conflict', { keys: keysLabel(status.keys, mac) }),
        };
    }
    return null;
}

/**
 * Why a change to a shortcut failed: the keys it tried, taken by another app or by another of
 * Sidekyk's shortcuts, or the error as it reads.
 */
export function shortcutChangeError(
    action: ShortcutAction,
    error: unknown,
    keys: string,
    statuses: GlobalShortcutStatuses | undefined,
    mac: boolean,
    i18n: Translator,
): string {
    if (hasErrorCode(error, 'shortcut_taken')) return takenMessage(keys, mac, i18n);
    if (hasErrorCode(error, 'shortcut_in_use')) {
        return inUseMessage(action, keys, statuses, mac, i18n);
    }
    return errorMessage(error, i18n);
}
