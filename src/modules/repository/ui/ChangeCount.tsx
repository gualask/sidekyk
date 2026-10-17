import type { ProjectInfo } from '@/shared/projects/project-info';
import { useRepositorySummary } from '../application/repository.queries';
import { changedCount } from '../model/summary';

/** How many files changed in a project, as a dot on its avatar; nothing when it is clean. */
export function ChangeCount({
    project,
    fromSnapshot,
}: {
    project: ProjectInfo;
    /** The Changes panel shows the project, and its snapshot brings the count. */
    fromSnapshot: boolean;
}) {
    const summary = useRepositorySummary(project.root, { fromSnapshot });
    const files = summary.data?.totals.files ?? 0;
    if (!summary.data || files === 0) return null;

    return (
        <span className="pointer-events-none absolute -top-[3px] -right-[3px] grid h-4 min-w-4 place-items-center rounded-full border-2 border-ui-surface bg-ui-warning px-1 text-[10px] leading-none font-bold text-ui-warning-on-solid">
            <span aria-hidden="true">{files > 99 ? '99+' : String(files)}</span>
            <span className="sr-only">
                {files === 1 ? '(1 changed file)' : `(${changedCount(summary.data)} changed files)`}
            </span>
        </span>
    );
}
