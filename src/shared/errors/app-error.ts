/** The `{ code, message }` payload every native command fails with. */
interface AppErrorPayload {
    code: string;
    message: string;
}

const USER_MESSAGES: Record<string, string> = {
    export_in_repository:
        'Sidekyk never writes inside a repository: pick a folder outside your projects.',
    file_missing: 'This file is no longer in the repository: it was moved or deleted.',
    git_not_found: 'Git is not installed. Install it (for example with xcode-select --install).',
    git_timed_out:
        'Git took more than 30 seconds to answer and was stopped. Is the repository on a slow or unreachable drive?',
    invalid_commit: 'That is not a commit of this repository.',
    invalid_shortcut: 'That is not a keyboard shortcut Sidekyk can register.',
    not_a_repository: 'That folder is not inside a git repository.',
    note_list_missing: 'That list of notes is no longer there.',
    note_missing: 'That note is no longer there.',
    note_too_long: 'That note is too long: a note holds at most 1 MB of text.',
    path_outside_repository: 'That path is outside the repository.',
    project_not_found: 'That repository is no longer in Sidekyk.',
    repository_missing:
        'This repository was moved or deleted. Remove it from All projects, then add it again from its new folder.',
    shortcut_taken: 'Another app or the system already uses that shortcut. Pick another.',
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

export function errorMessage(error: unknown): string {
    if (isAppErrorPayload(error)) return USER_MESSAGES[error.code] ?? error.message;
    if (error instanceof Error) return error.message;
    return String(error);
}
