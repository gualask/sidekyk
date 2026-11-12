import { type QueryCache, useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { hasErrorCode } from '@/shared/errors/app-error';
import { repositoryKeys } from './repository-keys';

/** The failures of a folder's reads that need the user, the weightiest first. */
const FOLDER_FAILURES = [
    'distro_missing',
    'repository_missing',
    'helper_failed',
    'git_not_found',
] as const;
export type FolderFailure = (typeof FOLDER_FAILURES)[number];

/** Each folder's weightiest failure, as `<failure>\u0001<id>` joined by NUL (no id has either). */
function failedFolders(cache: QueryCache): string {
    const failures = new Map<string, FolderFailure>();
    for (const query of cache.findAll({ queryKey: repositoryKeys.all, type: 'all' })) {
        if (query.state.status !== 'error') continue;
        const failure = FOLDER_FAILURES.find((code) => hasErrorCode(query.state.error, code));
        if (!failure) continue;
        const id = query.queryKey[1] as string;
        const known = failures.get(id);
        if (!known || FOLDER_FAILURES.indexOf(failure) < FOLDER_FAILURES.indexOf(known)) {
            failures.set(id, failure);
        }
    }
    return [...failures]
        .map(([id, failure]) => `${failure}\u0001${id}`)
        .sort((a, b) => a.localeCompare(b))
        .join('\0');
}

/**
 * The folders whose reads failed in a way that needs the user (moved, a WSL distro gone, no git
 * there, the helper not starting), by id, from what was already read of them: nothing is fetched
 * to know it. One that reads well again leaves the map.
 */
export function useFolderFailures(): ReadonlyMap<string, FolderFailure> {
    const cache = useQueryClient().getQueryCache();
    const failed = useSyncExternalStore(
        // only a read ending or going changes a failure: not a query made, as one is while a
        // component renders
        (onChange) =>
            cache.subscribe(({ type }) => {
                if (type === 'updated' || type === 'removed') onChange();
            }),
        () => failedFolders(cache),
    );
    return useMemo(
        () =>
            new Map(
                (failed ? failed.split('\0') : []).map((entry) => {
                    const [failure, id] = entry.split('\u0001');
                    return [id, failure as FolderFailure];
                }),
            ),
        [failed],
    );
}
