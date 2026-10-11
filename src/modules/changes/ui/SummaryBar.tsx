import {
    IconArrowDown,
    IconArrowUp,
    IconFolderOpen,
    IconGitBranch,
    IconRefresh,
} from '@tabler/icons-react';
import { usePickRepository, useRefreshRepository } from '../application/repository.queries';
import type { RepositoryInfo, RepositorySnapshot } from '../model/repository.types';
import { LineCounts } from './LineCounts';

function branchLabel(snapshot: RepositorySnapshot): string {
    const { head, commit } = snapshot.branch;
    if (head) return head;
    return commit ? `detached at ${commit}` : 'detached';
}

export function SummaryBar({
    repository,
    snapshot,
    refreshing,
}: {
    repository: RepositoryInfo;
    snapshot: RepositorySnapshot | undefined;
    refreshing: boolean;
}) {
    const pick = usePickRepository();
    const refresh = useRefreshRepository();
    const totals = snapshot?.totals;
    const dirty = (totals?.files ?? 0) > 0;

    return (
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-ui-border bg-ui-surface px-4">
            <div className="flex min-w-0 items-baseline gap-2">
                <h1 className="shrink-0 text-sm font-semibold">{repository.name}</h1>
                <span className="truncate text-xs text-ui-text-muted" title={repository.root}>
                    {repository.root}
                </span>
            </div>

            {snapshot ? (
                <div className="flex shrink-0 items-center gap-1.5">
                    <span className="chip" title={snapshot.branch.upstream ?? 'No upstream'}>
                        <IconGitBranch size={14} />
                        {branchLabel(snapshot)}
                    </span>
                    {snapshot.branch.ahead > 0 && (
                        <span className="chip" title="Commits not pushed">
                            <IconArrowUp size={13} />
                            {snapshot.branch.ahead}
                        </span>
                    )}
                    {snapshot.branch.behind > 0 && (
                        <span className="chip" title="Commits not pulled">
                            <IconArrowDown size={13} />
                            {snapshot.branch.behind}
                        </span>
                    )}
                </div>
            ) : null}

            <div className="ml-auto flex shrink-0 items-center gap-3">
                {totals ? (
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-ui-text-secondary">
                            {totals.files} {totals.files === 1 ? 'file' : 'files'}
                        </span>
                        <LineCounts additions={totals.additions} deletions={totals.deletions} />
                        <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${
                                dirty
                                    ? 'bg-ui-warning-soft text-ui-warning-soft-text'
                                    : 'bg-ui-success-soft text-ui-success-soft-text'
                            }`}
                        >
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${dirty ? 'bg-ui-warning' : 'bg-ui-success'}`}
                            />
                            {dirty ? 'Uncommitted changes' : 'Clean'}
                        </span>
                    </div>
                ) : null}
                <button
                    type="button"
                    className="btn-icon"
                    aria-label="Refresh"
                    title="Refresh"
                    onClick={() => void refresh()}
                >
                    <IconRefresh
                        size={17}
                        className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''}
                    />
                </button>
                <button
                    type="button"
                    className="btn-icon"
                    aria-label="Open another repository"
                    title="Open another repository"
                    disabled={pick.isPending}
                    onClick={() => pick.mutate()}
                >
                    <IconFolderOpen size={17} />
                </button>
            </div>
        </header>
    );
}
