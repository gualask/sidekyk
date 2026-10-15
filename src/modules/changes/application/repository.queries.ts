import { type QueryCache, type QueryState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { hasErrorCode } from '@/shared/errors/app-error';
import { commitRequest } from '../model/commits';
import type {
    Commit,
    CommitFileDiffRequest,
    CommitRequest,
    FileDiffRequest,
} from '../model/repository.types';
import { useRepositoryPort } from './repository.port';

/** Every query of a repository starts with its root, so a change on disk refetches only its own. */
const repositoryKeys = {
    all: ['repository'] as const,
    of: (root: string) => [...repositoryKeys.all, root] as const,
    snapshot: (root: string) => [...repositoryKeys.of(root), 'snapshot'] as const,
    summary: (root: string) => [...repositoryKeys.of(root), 'summary'] as const,
    diff: (root: string, request: FileDiffRequest) =>
        [...repositoryKeys.of(root), 'diff', request.area, request.path, request.origPath] as const,
    commits: (root: string) => [...repositoryKeys.of(root), 'commits'] as const,
};

/**
 * What a commit changed never changes: kept apart from the repository's keys, so neither a change
 * on disk nor the window showing again reads it twice.
 */
const commitKeys = {
    of: (root: string, commit: CommitRequest) =>
        ['commit', root, commit.sha, commit.parent] as const,
    files: (root: string, commit: CommitRequest) =>
        [...commitKeys.of(root, commit), 'files'] as const,
    diff: (root: string, request: CommitFileDiffRequest) =>
        [...commitKeys.of(root, request.commit), 'diff', request.path, request.origPath] as const,
};

/**
 * How old a read may be when the window or level 0 shows again, before it is read once more
 * (decided with its cases in docs/evolution.md, Projects). The project on screen is read at once
 * when its watcher saw a change while the window was hidden.
 */
const READ_AGAIN_AFTER_MS = 30_000;

function isOld({ state }: { state: QueryState<unknown> }): boolean {
    const readAt = Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
    return Date.now() - readAt > READ_AGAIN_AFTER_MS;
}

export function useRepositorySnapshot(root: string) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    return useQuery({
        queryKey: repositoryKeys.snapshot(root),
        queryFn: async () => {
            const snapshot = await port.getSnapshot(root);
            // the same git output, so the breadcrumb and the rail need no call of their own
            queryClient.setQueryData(repositoryKeys.summary(root), snapshot.summary);
            return snapshot;
        },
    });
}

/**
 * A repository at a glance, for every project on screen. `fromSnapshot` says the Changes panel
 * shows it: its snapshot then brings the summary, and the summary is never fetched on its own.
 * `freshOnShow` reads it again each time the component shows, as the cards of all projects do,
 * unless it was read in the last 30 s.
 *
 * A summary is kept until something says it changed: the watcher, for the project on screen; the
 * window coming back, when an agent may have worked on any project meanwhile; or the cards of all
 * projects showing. The other projects are not watched: nothing runs for them while nobody looks.
 */
export function useRepositorySummary(
    root: string,
    { fromSnapshot = false, freshOnShow = false } = {},
) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.summary(root),
        queryFn: () => port.getSummary(root),
        enabled: !fromSnapshot,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: freshOnShow ? (query) => (isOld(query) ? 'always' : false) : true,
    });
}

export function useFileDiff(root: string, request: FileDiffRequest | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: request
            ? repositoryKeys.diff(root, request)
            : [...repositoryKeys.of(root), 'none'],
        queryFn: () => (request ? port.getFileDiff(root, request) : null),
        enabled: request !== null,
    });
}

/**
 * The last commits of the branch on screen, read only while `open`: the section is closed until
 * asked for, and costs nothing until then. Once open, a change of HEAD or refs reads it again.
 */
export function useRecentCommits(root: string, open: boolean) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.commits(root),
        queryFn: () => port.getRecentCommits(root),
        enabled: open,
    });
}

/** The files a commit changed, read once: a commit never changes. */
export function useCommitFiles(root: string, commit: Commit | null) {
    const port = useRepositoryPort();
    const request = commit ? commitRequest(commit) : null;
    return useQuery({
        queryKey: request ? commitKeys.files(root, request) : ['commit', root, 'none'],
        queryFn: () => (request ? port.getCommitFiles(root, request) : null),
        enabled: request !== null,
        staleTime: Number.POSITIVE_INFINITY,
    });
}

export function useCommitFileDiff(root: string, request: CommitFileDiffRequest) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: commitKeys.diff(root, request),
        queryFn: () => port.getCommitFileDiff(root, request),
        staleTime: Number.POSITIVE_INFINITY,
    });
}

/** The roots whose last read failed as moved or deleted, joined by NUL (no path has one). */
function missingRoots(cache: QueryCache): string {
    const roots = new Set<string>();
    for (const query of cache.findAll({ queryKey: repositoryKeys.all, type: 'all' })) {
        if (
            query.state.status === 'error' &&
            hasErrorCode(query.state.error, 'repository_missing')
        ) {
            roots.add(query.queryKey[1] as string);
        }
    }
    return [...roots].sort().join('\0');
}

/**
 * The repositories found moved or deleted, from what was already read of them: nothing is
 * fetched to know it. One reads well again, and it leaves the list.
 */
export function useMissingRepositories(): readonly string[] {
    const cache = useQueryClient().getQueryCache();
    const roots = useSyncExternalStore(
        (onChange) => cache.subscribe(onChange),
        () => missingRoots(cache),
    );
    return useMemo(() => (roots ? roots.split('\0') : []), [roots]);
}

/**
 * Refetches what is shown of a repository whenever the backend reports a change on disk in it. A
 * summary that comes with the snapshot is not fetched: its snapshot refetches and brings it.
 *
 * While the window is minimized, hidden or covered, the backend reports nothing and no git runs.
 * When it shows again, what is on screen is read again if the watcher saw its project change
 * meanwhile, or if it is older than 30 s: the other projects are not watched, and the watcher
 * cannot see everything (a repository on a network drive). Shown again within 30 s with nothing
 * changed, as when switching back and forth with the agent's terminal, nothing runs.
 */
export function useRepositoryChangeSubscription() {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    useEffect(
        () =>
            port.onRepositoryChanged(({ root, gitDir }) => {
                void queryClient.invalidateQueries({
                    queryKey: repositoryKeys.of(root),
                    // files written in the working tree make no commit
                    predicate: (query) => gitDir || query.queryKey[2] !== 'commits',
                });
            }),
        [port, queryClient],
    );
    useEffect(() => {
        const report = async () => {
            const visible = !document.hidden;
            const missed = await port.setWindowVisible(visible);
            if (!visible) return;
            void queryClient.refetchQueries(
                {
                    queryKey: repositoryKeys.all,
                    type: 'active',
                    predicate: (query) => query.queryKey[1] === missed || isOld(query),
                },
                // a read already under way started after the window showed
                { cancelRefetch: false },
            );
        };
        // One report at a time, each with the visibility of its moment: when the window flickers,
        // the backend still ends on the last one, never hidden while the window shows.
        let reports = Promise.resolve();
        const onChange = () => {
            reports = reports.then(report);
        };
        // the backend starts with the window visible
        if (document.hidden) onChange();
        document.addEventListener('visibilitychange', onChange);
        return () => document.removeEventListener('visibilitychange', onChange);
    }, [port, queryClient]);
}
