import { type QueryCache, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { hasErrorCode } from '@/shared/errors/app-error';
import type { FileDiffRequest } from '../model/repository.types';
import { useRepositoryPort } from './repository.port';

/** Every query of a repository starts with its root, so a change on disk refetches only its own. */
const repositoryKeys = {
    all: ['repository'] as const,
    of: (root: string) => [...repositoryKeys.all, root] as const,
    snapshot: (root: string) => [...repositoryKeys.of(root), 'snapshot'] as const,
    summary: (root: string) => [...repositoryKeys.of(root), 'summary'] as const,
    diff: (root: string, request: FileDiffRequest) =>
        [...repositoryKeys.of(root), 'diff', request.area, request.path, request.origPath] as const,
};

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
        // a safety net for changes the watcher cannot see, such as a repository on a network drive
        refetchOnWindowFocus: true,
    });
}

/**
 * A repository at a glance, for every project on screen. `fromSnapshot` says the Changes panel
 * shows it: its snapshot then brings the summary, and the summary is never fetched on its own.
 * `freshOnShow` reads it again each time the component shows, as the cards of all projects do.
 *
 * A summary is kept until something says it changed: the watcher, for the project on screen; the
 * window coming back to the front, when an agent may have worked on any project meanwhile; or the
 * cards of all projects showing. The other projects are not watched: nothing runs for them while
 * nobody looks.
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
        refetchOnMount: freshOnShow ? 'always' : true,
        refetchOnWindowFocus: 'always',
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
        // changes made while the window was hidden were not reported
        refetchOnWindowFocus: true,
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
 * When it shows again, what is on screen refetches as it does whenever the page becomes visible
 * (`refetchOnWindowFocus`, which TanStack Query ties to the page's visibility).
 */
export function useRepositoryChangeSubscription() {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    useEffect(
        () =>
            port.onRepositoryChanged(({ root }) => {
                void queryClient.invalidateQueries({ queryKey: repositoryKeys.of(root) });
            }),
        [port, queryClient],
    );
    useEffect(() => {
        const report = () => port.setWindowVisible(!document.hidden);
        // the backend starts with the window visible
        if (document.hidden) report();
        document.addEventListener('visibilitychange', report);
        return () => document.removeEventListener('visibilitychange', report);
    }, [port]);
}
