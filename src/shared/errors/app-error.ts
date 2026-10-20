import type { MessageKey, Translator } from '@/shared/i18n';

/** The `{ code, message }` payload every native command fails with. */
interface AppErrorPayload {
    code: string;
    message: string;
}

/** The message of each code the backend sends; any other shows the backend's own. */
const USER_MESSAGES: Record<string, MessageKey> = {
    distro_missing: 'error.distroMissing',
    distro_stopped: 'error.distroStopped',
    export_in_repository: 'error.exportInRepository',
    file_missing: 'error.fileMissing',
    git_not_found: 'error.gitNotFound',
    git_timed_out: 'error.gitTimedOut',
    helper_failed: 'error.helperFailed',
    invalid_commit: 'error.invalidCommit',
    invalid_shortcut: 'error.invalidShortcut',
    not_a_repository: 'error.notARepository',
    note_list_missing: 'error.noteListMissing',
    note_missing: 'error.noteMissing',
    note_too_long: 'error.noteTooLong',
    path_outside_repository: 'error.pathOutsideRepository',
    project_not_found: 'error.projectNotFound',
    repository_missing: 'error.repositoryMissing',
    shortcut_taken: 'error.shortcutTaken',
};

function isAppErrorPayload(error: unknown): error is AppErrorPayload {
    return (
        typeof error === 'object' &&
        error !== null &&
        typeof (error as AppErrorPayload).code === 'string' &&
        typeof (error as AppErrorPayload).message === 'string'
    );
}

/** Whether a native command failed with this code. */
export function hasErrorCode(error: unknown, code: string): boolean {
    return isAppErrorPayload(error) && error.code === code;
}

export function errorMessage(error: unknown, i18n: Translator): string {
    if (isAppErrorPayload(error)) {
        const key = USER_MESSAGES[error.code];
        return key ? i18n.t(key) : error.message;
    }
    if (error instanceof Error) return error.message;
    return String(error);
}
