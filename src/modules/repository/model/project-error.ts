import { errorMessage, hasErrorCode } from '@/shared/errors/app-error';
import type { ProjectLocation } from '@/shared/projects/project-info';

/**
 * A failure to read a project, as its panels and card tell it: git missing is the distro's for a
 * WSL project, which the top bar's warning says how to fix.
 */
export function projectErrorMessage(error: unknown, location: ProjectLocation): string {
    if (location.kind === 'wsl' && hasErrorCode(error, 'git_not_found')) {
        return `Git is not installed in ${location.distro}: see the top bar's warning.`;
    }
    return errorMessage(error);
}
