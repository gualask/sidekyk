import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import type { FileDiffRequest } from '../model/repository.types';
import { useRepositoryPort } from './repository.port';

const repositoryKeys = {
    all: ['repository'] as const,
    active: () => [...repositoryKeys.all, 'active'] as const,
    snapshot: (root: string) => [...repositoryKeys.all, 'snapshot', root] as const,
    diff: (root: string, request: FileDiffRequest) =>
        [
            ...repositoryKeys.all,
            'diff',
            root,
            request.area,
            request.path,
            request.origPath,
        ] as const,
};

export function useActiveRepository() {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.active(),
        queryFn: () => port.getActiveRepository(),
    });
}

export function useRepositorySnapshot(root: string) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.snapshot(root),
        queryFn: () => port.getSnapshot(),
        // a safety net for changes the watcher cannot see, such as a repository on a network drive
        refetchOnWindowFocus: true,
    });
}

export function useFileDiff(root: string, request: FileDiffRequest | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: request ? repositoryKeys.diff(root, request) : [...repositoryKeys.all, 'none'],
        queryFn: () => (request ? port.getFileDiff(request) : null),
        enabled: request !== null,
    });
}

export function useRefreshRepository() {
    const queryClient = useQueryClient();
    return useCallback(
        () => queryClient.invalidateQueries({ queryKey: repositoryKeys.all }),
        [queryClient],
    );
}

/** Refetches everything shown whenever the backend reports a change on disk. */
export function useRepositoryChangeSubscription() {
    const port = useRepositoryPort();
    const refresh = useRefreshRepository();
    useEffect(
        () =>
            port.onRepositoryChanged(() => {
                void refresh();
            }),
        [port, refresh],
    );
}

export function usePickRepository() {
    const port = useRepositoryPort();
    const refresh = useRefreshRepository();
    return useMutation({
        mutationFn: () => port.pickRepository(),
        onSuccess: () => refresh(),
    });
}
