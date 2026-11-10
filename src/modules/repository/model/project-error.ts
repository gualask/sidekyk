import { errorMessage, hasErrorCode } from '@/shared/errors/app-error';
import type { Translator } from '@/shared/i18n';
import type { ProjectLocation } from '@/shared/projects/project-info';
import { remoteMachine } from '@/shared/projects/project-place';

/**
 * A failure to read a project, as its panels and row tell it: git missing is the distro's for a
 * WSL project, which the top bar's warning says how to fix.
 */
export function projectErrorMessage(
    error: unknown,
    folder: ProjectLocation | null,
    i18n: Translator,
): string {
    const distro = folder ? remoteMachine(folder) : null;
    if (distro && hasErrorCode(error, 'git_not_found')) {
        return i18n.t('error.gitNotInDistro', { distro });
    }
    return errorMessage(error, i18n);
}
