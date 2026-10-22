import { errorMessage, hasErrorCode } from '@/shared/errors/app-error';
import type { Translator } from '@/shared/i18n';
import type { ProjectLocation } from '@/shared/projects/project-info';

/**
 * A failure to read a project, as its panels and card tell it: git missing is the distro's for a
 * WSL project, which the top bar's warning says how to fix.
 */
export function projectErrorMessage(
    error: unknown,
    folder: ProjectLocation | null,
    i18n: Translator,
): string {
    if (folder?.kind === 'wsl' && hasErrorCode(error, 'git_not_found')) {
        return i18n.t('error.gitNotInDistro', { distro: folder.distro });
    }
    return errorMessage(error, i18n);
}
