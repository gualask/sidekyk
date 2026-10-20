import { errorMessage, hasErrorCode } from '@/shared/errors/app-error';
import type { Translator } from '@/shared/i18n';
import type { GlobalShortcutStatus } from './settings.types';
import { formatShortcut } from './shortcut-keys';

/** Why a shortcut does not work, in a sentence. */
function takenMessage(keys: string, mac: boolean, i18n: Translator): string {
    return i18n.t('shortcut.taken', { keys: formatShortcut(keys, mac) });
}

/** Why a shortcut registered may still not reach Sidekyk. */
function conflictMessage(keys: string, mac: boolean, i18n: Translator): string {
    return i18n.t('shortcut.conflict', { keys: formatShortcut(keys, mac) });
}

/** What is wrong with the global shortcut, for the top bar's problems; null when nothing is. */
export function shortcutProblem(
    status: GlobalShortcutStatus | undefined,
    mac: boolean,
    i18n: Translator,
): { title: string; detail: string } | null {
    if (status?.kind === 'refused') {
        return {
            title: i18n.t('shortcut.off'),
            detail: takenMessage(status.keys, mac, i18n),
        };
    }
    if (status?.kind === 'active' && status.conflict) {
        return {
            title: i18n.t('shortcut.mayNotWork'),
            detail: conflictMessage(status.keys, mac, i18n),
        };
    }
    return null;
}

/** Why a change to the shortcut failed: the keys it tried, taken, or the error as it reads. */
export function shortcutChangeError(
    error: unknown,
    keys: string,
    mac: boolean,
    i18n: Translator,
): string {
    return hasErrorCode(error, 'shortcut_taken')
        ? takenMessage(keys, mac, i18n)
        : errorMessage(error, i18n);
}
