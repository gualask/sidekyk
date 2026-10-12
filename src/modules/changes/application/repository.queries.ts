import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { FileDiffRequest } from '../model/repository.types';
import { useRepositoryPort } from './repository.port';

/** Every query of a repository starts with its root, so a change on disk refetches only its own. */
const repositoryKeys = {
    of: (root: string) => ['repository', root] as const,
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
 *
 * A summary is kept until something says it changed: the watcher, for the project on screen, or
 * the window coming back to the front, when an agent may have worked on any project meanwhile.
 */
export function useRepositorySummary(root: string, { fromSnapshot = false } = {}) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.summary(root),
        queryFn: () => port.getSummary(root),
        enabled: !fromSnapshot,
        staleTime: Number.POSITIVE_INFINITY,
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
    });
}

/**
 * Refetches what is shown of a repository whenever the backend reports a change on disk in it. A
 * summary that comes with the snapshot is not fetched: its snapshot refetches and brings it.
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
}
