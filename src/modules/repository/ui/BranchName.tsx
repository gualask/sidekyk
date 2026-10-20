import { IconGitBranch } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import { branchLabel } from '../model/branch';
import type { BranchStatus } from '../model/repository.types';

/** The branch with its icon, cut with "…" when short of room, and the commits not pushed (↑) or not pulled (↓). */
export function BranchName({
    branch,
    className = '',
}: {
    branch: BranchStatus;
    className?: string;
}) {
    const i18n = useTranslation();
    const { t } = i18n;
    const label = branchLabel(branch, i18n);
    return (
        <span
            className={`inline-flex min-w-0 items-center gap-1 font-mono ${className}`}
            title={`${label} (${
                branch.upstream
                    ? t('branch.tracking', { upstream: branch.upstream })
                    : t('branch.noUpstream')
            })`}
        >
            <IconGitBranch size={13} className="shrink-0" />
            <span className="truncate">{label}</span>
            {branch.ahead > 0 ? <span title={t('branch.notPushed')}>↑{branch.ahead}</span> : null}
            {branch.behind > 0 ? <span title={t('branch.notPulled')}>↓{branch.behind}</span> : null}
        </span>
    );
}
