import { IconFolderOpen, IconGitCommit } from '@tabler/icons-react';
import { errorMessage } from '@/shared/errors/app-error';
import { usePickRepository } from '../application/repository.queries';

export function NoRepository() {
    const pick = usePickRepository();

    return (
        <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ui-accent-soft text-ui-accent-on-soft">
                <IconGitCommit size={28} stroke={1.75} />
            </div>
            <div className="max-w-sm space-y-1.5">
                <h1 className="text-lg font-semibold">Open a repository to review</h1>
                <p className="text-sm text-ui-text-muted">
                    Sidekyk watches the working tree and shows what changed since the last commit,
                    while your agent keeps working.
                </p>
            </div>
            <button
                type="button"
                className="btn-primary"
                disabled={pick.isPending}
                onClick={() => pick.mutate()}
            >
                <IconFolderOpen size={18} />
                Open repository
            </button>
            {pick.isError ? (
                <p className="text-sm text-ui-danger" role="alert">
                    {errorMessage(pick.error)}
                </p>
            ) : null}
        </div>
    );
}
