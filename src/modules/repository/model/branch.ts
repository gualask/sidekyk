import type { Translator } from '@/shared/i18n';
import type { BranchStatus } from './repository.types';

/** The branch, or the commit HEAD is detached at. */
export function branchLabel({ head, commit }: BranchStatus, { t }: Translator): string {
    if (head) return head;
    return commit ? t('branch.detachedAt', { commit }) : t('branch.detached');
}
