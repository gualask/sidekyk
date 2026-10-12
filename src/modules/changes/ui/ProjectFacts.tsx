import type { ProjectInfo } from '@/shared/projects/project-info';
import { useRepositorySummary } from '../application/repository.queries';
import { BranchName } from './BranchName';
import { LineCounts } from './LineCounts';

/** The project's facts, next to its name in the breadcrumb: its branch and what changed. */
export function ProjectFacts({
    project,
    fromSnapshot,
}: {
    project: ProjectInfo;
    /** The Changes panel shows the project, and its snapshot brings the facts. */
    fromSnapshot: boolean;
}) {
    const summary = useRepositorySummary(project.root, { fromSnapshot });
    if (!summary.data) return null;
    const { branch, totals } = summary.data;

    return (
        <span className="flex shrink-0 items-center gap-2.5 text-xs whitespace-nowrap text-ui-text-muted">
            <BranchName branch={branch} className="text-[11.5px]" />
            {totals.files > 0 ? (
                <span className="inline-flex items-center gap-2">
                    {totals.files} changed
                    {totals.additions + totals.deletions > 0 ? (
                        <span title="Lines of tracked files">
                            <LineCounts additions={totals.additions} deletions={totals.deletions} />
                        </span>
                    ) : null}
                </span>
            ) : (
                <span>clean</span>
            )}
        </span>
    );
}
