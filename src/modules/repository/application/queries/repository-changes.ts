import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useRepositoryPort } from '../repository.port';
import { isOld, repositoryKeys, worktreeChangeTouches } from './repository-keys';

/** Reads again what is shown of a folder: after a fix, such as git installed in its distro. */
export function useReadFolderAgain(): (folderId: string) => void {
    const queryClient = useQueryClient();
    return useCallback(
        (folderId: string) => {
            const queryKey = repositoryKeys.of(folderId);
            void queryClient.invalidateQueries({ queryKey });
            // a failed read off screen too: the problem it raised goes once it reads well
            void queryClient.invalidateQueries({
                queryKey,
                predicate: (query) => query.state.status === 'error',
                refetchType: 'all',
            });
        },
        [queryClient],
    );
}

/**
 * Refetches what is shown of a repository whenever the backend reports a change on disk in it. A
 * summary that comes with the snapshot is not fetched: its snapshot refetches and brings it.
 *
 * While the window is minimized, hidden or covered, the backend reports nothing and no git runs.
 * When it shows again, what is on screen is read again if the watcher saw its folder change
 * meanwhile, or if it is older than 30 s: the other folders are not watched, and the watcher
 * cannot see everything (a repository on a network drive). Shown again within 30 s with nothing
 * changed, as when switching back and forth with the agent's terminal, nothing runs.
 */
export function useRepositoryChangeSubscription() {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    useEffect(
        () =>
            port.onRepositoryChanged(({ folderId, gitDir, paths, kindChanged }) => {
                const queryKey = repositoryKeys.of(folderId);
                // the folder is now the other kind: what was read of it goes, its kind read again
                if (kindChanged) {
                    void queryClient.resetQueries({ queryKey });
                    return;
                }
                void queryClient.invalidateQueries({
                    queryKey,
                    predicate: ({ queryKey }) => gitDir || worktreeChangeTouches(queryKey, paths),
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
