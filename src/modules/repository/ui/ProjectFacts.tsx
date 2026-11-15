import { useTranslation } from '@/shared/i18n';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { useRepositorySummaries, useRepositorySummary } from '../application/queries/snapshot';
import { changedLabel } from '../model/history/summary';
import type { RepositorySummary } from '../model/repository.types';
import { TrackedLines } from './LineCounts';
import { BranchName } from './summary/BranchName';

/**
 * The project's facts, next to its name in the breadcrumb: its branch, a click away from the
 * others (as VS Code's status bar), and what changed.
 */
export function ProjectFacts({
    folder,
    fromSnapshot,
    onSwitchBranch,
}: {
    /** The project's folder on screen. */
    folder: ProjectFolder;
    /** The Changes panel shows the folder, and its snapshot brings the facts. */
    fromSnapshot: boolean;
    onSwitchBranch: () => void;
}) {
    const summary = useRepositorySummary(folder.id, { fromSnapshot });
    return summary.data ? <Facts summary={summary.data} onSwitchBranch={onSwitchBranch} /> : null;
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

/** A repository's branch, which switches it to another, and what changed, muted. */
function Facts({
    summary,
    onSwitchBranch,
}: {
    summary: RepositorySummary;
    onSwitchBranch: () => void;
}) {
    const { t } = useTranslation();
    return (
        <span className="flex shrink-0 items-center gap-2.5 text-xs whitespace-nowrap text-ui-text-muted">
            <button
                type="button"
                aria-label={t('branch.switch')}
                onClick={onSwitchBranch}
                className="-mx-1 flex min-w-0 rounded-md px-1 py-0.5 transition-colors hover:bg-ui-surface-hover hover:text-ui-text-secondary focus-visible:outline-2 focus-visible:outline-ui-accent"
            >
                <BranchName branch={summary.branch} className="text-[11.5px]" />
            </button>
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
