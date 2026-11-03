import { useTranslation } from '@/shared/i18n';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { useRepositorySummaries, useRepositorySummary } from '../application/repository.queries';
import type { RepositorySummary } from '../model/repository.types';
import { changedLabel } from '../model/summary';
import { BranchName } from './BranchName';
import { TrackedLines } from './LineCounts';

/** The project's facts, next to its name in the breadcrumb: its branch and what changed. */
export function ProjectFacts({
    folder,
    fromSnapshot,
}: {
    /** The project's folder on screen. */
    folder: ProjectFolder;
    /** The Changes panel shows the folder, and its snapshot brings the facts. */
    fromSnapshot: boolean;
}) {
    const summary = useRepositorySummary(folder.id, { fromSnapshot });
    return summary.data ? <Facts summary={summary.data} /> : null;
}

/**
 * A folder's facts in a row of its project's folders, as three cells of the row's grid
 * (`FOLDER_COLUMNS`), muted: a
 * repository's branch, the files changed (or "clean") and the lines, right-aligned (in a row of a
 * list, a `group`, they follow the row's highlight); read when
 * shown (an old read again), never starting a stopped WSL distro. The cells are there, empty,
 * while the summary is read and for a folder without git, so the columns stay in place.
 */
export function FolderFacts({ folder }: { folder: ProjectFolder }) {
    const [repository] = useRepositorySummaries([folder]);
    const summary = repository?.summary.data;
    const i18n = useTranslation();
    const totals = summary?.totals;
    return (
        <>
            <span className="flex min-w-0 text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft">
                {summary ? <BranchName branch={summary.branch} className="text-[11.5px]" /> : null}
            </span>
            <span className="truncate text-right text-xs text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft">
                {summary ? changedLabel(summary, i18n) : null}
            </span>
            <span className="text-right text-xs">
                {totals && totals.additions + totals.deletions > 0 ? (
                    <TrackedLines additions={totals.additions} deletions={totals.deletions} />
                ) : null}
            </span>
        </>
    );
}

/** A repository's branch and what changed, muted. */
function Facts({ summary }: { summary: RepositorySummary }) {
    return (
        <span className="flex shrink-0 items-center gap-2.5 text-xs whitespace-nowrap text-ui-text-muted">
            <BranchName branch={summary.branch} className="text-[11.5px]" />
            <ChangeCounts summary={summary} />
        </span>
    );
}

/** How many files and lines changed against HEAD, `8 changed +54 −27`, or "clean". */
function ChangeCounts({ summary }: { summary: RepositorySummary }) {
    const { totals } = summary;
    const i18n = useTranslation();
    return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {changedLabel(summary, i18n)}
            {totals.additions + totals.deletions > 0 ? (
                <TrackedLines additions={totals.additions} deletions={totals.deletions} />
            ) : null}
        </span>
    );
}
