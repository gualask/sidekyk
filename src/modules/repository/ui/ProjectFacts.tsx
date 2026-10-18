import type { ProjectInfo } from '@/shared/projects/project-info';
import { useRepositorySummary } from '../application/repository.queries';
import type { RepositorySummary } from '../model/repository.types';
import { changedCount } from '../model/summary';
import { BranchName } from './BranchName';
import { TrackedLines } from './LineCounts';

/** The project's facts, next to its name in the breadcrumb: its branch and what changed. */
export function ProjectFacts({
    project,
    fromSnapshot,
}: {
    project: ProjectInfo;
    /** The Changes panel shows the project, and its snapshot brings the facts. */
    fromSnapshot: boolean;
}) {
    const summary = useRepositorySummary(project.id, { fromSnapshot });
    if (!summary.data) return null;

    return (
        <span className="flex shrink-0 items-center gap-2.5 text-xs whitespace-nowrap text-ui-text-muted">
            <BranchName branch={summary.data.branch} className="text-[11.5px]" />
            <ChangeCounts summary={summary.data} />
        </span>
    );
}

/** How many files and lines changed against HEAD, `8 changed +54 −27`, or "clean". */
function ChangeCounts({ summary }: { summary: RepositorySummary }) {
    const { totals } = summary;
    if (totals.files === 0) return <span>clean</span>;
    return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {changedCount(summary)} changed
            {totals.additions + totals.deletions > 0 ? (
                <TrackedLines additions={totals.additions} deletions={totals.deletions} />
            ) : null}
        </span>
    );
}
