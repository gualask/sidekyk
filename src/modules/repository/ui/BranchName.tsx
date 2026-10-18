import { IconGitBranch } from '@tabler/icons-react';
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
    const label = branchLabel(branch);
    return (
        <span
            className={`inline-flex min-w-0 items-center gap-1 font-mono ${className}`}
            title={
                branch.upstream
                    ? `${label} (tracking ${branch.upstream})`
                    : `${label} (no upstream)`
            }
        >
            <IconGitBranch size={13} className="shrink-0" />
            <span className="truncate">{label}</span>
            {branch.ahead > 0 ? <span title="Commits not pushed">↑{branch.ahead}</span> : null}
            {branch.behind > 0 ? <span title="Commits not pulled">↓{branch.behind}</span> : null}
        </span>
    );
}
