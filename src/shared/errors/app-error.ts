/** The `{ code, message }` payload every native command fails with. */
interface AppErrorPayload {
    code: string;
    message: string;
}

const USER_MESSAGES: Record<string, string> = {
    git_not_found: 'Git is not installed. Install it (for example with xcode-select --install).',
    not_a_repository: 'That folder is not inside a git repository.',
    path_outside_repository: 'That path is outside the repository.',
    project_not_found: 'That repository is no longer in Sidekyk.',
    repository_missing:
        'This repository was moved or deleted. Remove it from All projects, then add it again from its new folder.',
};

function isAppErrorPayload(error: unknown): error is AppErrorPayload {
    return (
        typeof error === 'object' &&
        error !== null &&
        typeof (error as AppErrorPayload).code === 'string' &&
        typeof (error as AppErrorPayload).message === 'string'
    );
}

export function errorMessage(error: unknown): string {
    if (isAppErrorPayload(error)) return USER_MESSAGES[error.code] ?? error.message;
    if (error instanceof Error) return error.message;
    return String(error);
}
