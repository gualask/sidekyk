import type { BranchStatus } from './repository.types';

/** The branch, or the commit HEAD is detached at. */
export function branchLabel({ head, commit }: BranchStatus): string {
    if (head) return head;
    return commit ? `detached at ${commit}` : 'detached';
}
