import { type UseQueryResult, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectFolder } from '@/shared/projects/project-info';
import type { RepositorySnapshot, RepositorySummary } from '../../model/repository.types';
import { type RepositoryPort, useRepositoryPort } from '../repository.port';
import { useFolderKinds } from './folder-kind';
import { refetchOnShow, repositoryKeys } from './repository-keys';

/** A repository's snapshot; none read for a folder without git (`repository` false). */
export function useRepositorySnapshot(folderId: string, repository: boolean) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    return useQuery({
        queryKey: repositoryKeys.snapshot(folderId),
        queryFn: async () => {
            const snapshot = await port.getSnapshot(folderId);
            // the same git output, so the breadcrumb needs no call of its own
            queryClient.setQueryData(repositoryKeys.summary(folderId), snapshot.summary);
            return snapshot;
        },
        enabled: repository,
    });
}

/** A folder's snapshot as last read, if any, without reading one or watching for the next. */
export function useSnapshotOf(): (folderId: string) => RepositorySnapshot | undefined {
    const queryClient = useQueryClient();
    return (folderId) => queryClient.getQueryData(repositoryKeys.snapshot(folderId));
}

/**
 * A repository at a glance, for every project on screen. `fromSnapshot` says the Changes panel
 * shows it: its snapshot then brings the summary, and the summary is never fetched on its own.
 * `freshOnShow` reads it again each time the component shows, as the rows of all projects do,
 * unless it was read in the last 30 s.
 *
 * A summary is kept until something says it changed: the watcher, for the folder on screen; the
 * window coming back, when an agent may have worked on any project meanwhile; or the rows of all
 * projects showing. The other projects are not watched: nothing runs for them while nobody looks.
 */
export function useRepositorySummary(
    folderId: string,
    { fromSnapshot = false, freshOnShow = false } = {},
) {
    const port = useRepositoryPort();
    return useQuery({ ...summaryQuery(port, folderId, freshOnShow), enabled: !fromSnapshot });
}

/** The read of a repository's summary: one cache entry, whoever asks. */
function summaryQuery(port: RepositoryPort, folderId: string, freshOnShow: boolean) {
    return {
        queryKey: repositoryKeys.summary(folderId),
        queryFn: () => port.getSummary(folderId),
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: refetchOnShow(freshOnShow),
    } as const;
}

/**
 * The summaries of a project's repositories among its folders, for its row: each read again as
 * it shows unless read in the last 30 s, never starting a stopped WSL distro. A folder without
 * git has none, and one whose kind is not read yet none yet.
 */
export function useRepositorySummaries(
    folders: readonly ProjectFolder[],
): { folder: ProjectFolder; summary: UseQueryResult<RepositorySummary> }[] {
    const port = useRepositoryPort();
    const kinds = useFolderKinds(folders, true);
    const repositories = folders.filter((_, index) => kinds[index].kind === 'repository');
    const summaries = useQueries({
        queries: repositories.map((folder) => summaryQuery(port, folder.id, true)),
    });
    return repositories.map((folder, index) => ({ folder, summary: summaries[index] }));
}
