import {
    type UseQueryResult,
    useMutation,
    useQueries,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { hasErrorCode } from '@/shared/errors/app-error';
import type { ProjectFolder } from '@/shared/projects/project-info';
import type { FolderKind } from '../../model/repository.types';
import { type RepositoryPort, useRepositoryPort } from '../repository.port';
import { refetchOnShow, repositoryKeys } from './repository-keys';

/**
 * What a folder of a project is, for the panels it has: `null` without folder, `waiting` until read.
 * No git runs, so it answers at once. Never starts a stopped WSL distro, for a row or for the
 * project opened: `stopped` says so, and `useStartFolder` starts it. A kind that cannot be read
 * otherwise counts as a repository, as every folder did before: its panels and the problems tell
 * why.
 */
export function useFolderKind(
    folder: ProjectFolder | null,
    { freshOnShow = false } = {},
): FolderKindState {
    const port = useRepositoryPort();
    const folderId = folder?.id ?? null;
    const query = useQuery({
        ...folderKindQuery(port, folderId ?? '', freshOnShow),
        enabled: folderId !== null,
    });
    if (!folderId) return { kind: null, waiting: false, stopped: false };
    return folderKindState(query);
}

/** What a folder is as its panels take it (`useFolderKind`). */
interface FolderKindState {
    kind: FolderKind | null;
    waiting: boolean;
    stopped: boolean;
}

/** The read of a folder's kind: one cache entry, whoever asks. */
function folderKindQuery(port: RepositoryPort, folderId: string, freshOnShow: boolean) {
    return {
        queryKey: repositoryKeys.kind(folderId),
        queryFn: () => port.getFolderKind(folderId, false),
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: refetchOnShow(freshOnShow),
    } as const;
}

function folderKindState(query: UseQueryResult<FolderKind>): FolderKindState {
    if (query.isError) {
        const stopped = hasErrorCode(query.error, 'distro_stopped');
        return { kind: 'repository', waiting: false, stopped };
    }
    return { kind: query.data ?? null, waiting: query.isPending, stopped: false };
}

/** What each of `folders` is, in their order (`useFolderKind`). */
export function useFolderKinds(
    folders: readonly ProjectFolder[],
    freshOnShow: boolean,
): FolderKindState[] {
    const port = useRepositoryPort();
    return useQueries({
        queries: folders.map((folder) => folderKindQuery(port, folder.id, freshOnShow)),
    }).map(folderKindState);
}

/**
 * What a project's folders are, together, for its row's panels: a repository when one of them
 * is, else without git; `null` without folders, `waiting` until each is read. Never starts a
 * stopped WSL distro.
 */
export function useProjectKind(
    folders: readonly ProjectFolder[],
    { freshOnShow = false } = {},
): { kind: FolderKind | null; waiting: boolean } {
    const states = useFolderKinds(folders, freshOnShow);
    if (folders.length === 0) return { kind: null, waiting: false };
    const waiting = states.some((state) => state.waiting);
    const repository = states.some((state) => state.kind === 'repository');
    return { kind: repository ? 'repository' : 'plain', waiting };
}

/**
 * Starts the stopped WSL distro that holds a folder of a project, as its Start button asks: the
 * one read that may, its answer the folder's kind.
 */
export function useStartFolder(folderId: string) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => port.getFolderKind(folderId, true),
        onSuccess: (kind) => queryClient.setQueryData(repositoryKeys.kind(folderId), kind),
    });
}
