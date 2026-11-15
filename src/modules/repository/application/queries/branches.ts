import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchSwitch } from '../../model/repository.types';
import { useRepositoryPort } from '../repository.port';
import { repositoryKeys } from './repository-keys';

/** The branches of a folder's repository to switch to, read each time the picker opens. */
export function useBranches(folderId: string) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.branches(folderId),
        queryFn: () => port.getBranches(folderId),
        // what a fetch in a terminal brought since the last time
        refetchOnMount: 'always',
    });
}

/**
 * Switches a folder's repository to a branch, the one write. Its reads go again at once: the
 * watcher tells the same, a moment later.
 */
export function useSwitchBranch(folderId: string) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (request: BranchSwitch) => port.switchBranch(folderId, request),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: repositoryKeys.of(folderId) }),
    });
}
