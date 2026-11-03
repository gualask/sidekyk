import { hasErrorCode } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { PanelSummaryProps } from '@/shared/panels/panel';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { folderName } from '@/shared/projects/project-place';
import { CardWell, WellMessage } from '@/shared/ui/CardWell';
import { Stat } from '@/shared/ui/Stat';
import { useRepositorySummaries, useRepositorySummary } from '../application/repository.queries';
import { branchLabel } from '../model/branch';
import { projectErrorMessage } from '../model/project-error';
import { type ChangedTotals, changedCount, changedLabel, summedTotals } from '../model/summary';
import { BranchName } from './BranchName';
import { TrackedLines } from './LineCounts';
import { WeekOfCommits } from './WeekOfCommits';

/**
 * What Changes tells about a project on its card at all projects: the branch under its name, how
 * many files and lines changed among the card's numbers (quiet when clean, so that the projects at
 * work stand out), and the lines committed day by day in the last week below, or why the
 * repository could not be read. Loaded with level 0; the summary is read again each time it shows,
 * since all projects is where one looks for the projects with changes.
 */
export function ChangesSummary({ project, folder, part }: PanelSummaryProps) {
    if (project.folders.length > 1) return <SeveralSummary folders={project.folders} part={part} />;
    // a repository's summary: only a project with a folder has one
    if (!folder) return null;
    if (part === 'lead') return <BranchLine folder={folder} />;
    if (part === 'facts') return <Counts folder={folder} />;
    return <WeekOrProblem folder={folder} />;
}

/** One summary for the three parts: read once, each time the card shows. */
function useCardSummary(folder: ProjectFolder) {
    return useRepositorySummary(folder.id, { freshOnShow: true });
}

function BranchLine({ folder }: { folder: ProjectFolder }) {
    const summary = useCardSummary(folder);
    if (!summary.data) return null;
    return (
        <div className="flex min-w-0 text-xs text-ui-text-muted">
            <BranchName branch={summary.data.branch} className="text-[11.5px]" />
        </div>
    );
}

function Counts({ folder }: { folder: ProjectFolder }) {
    const summary = useCardSummary(folder);
    return summary.data ? <Totals totals={summary.data} /> : null;
}

/** How many files and lines changed, among the card's numbers. */
function Totals({ totals: changed }: { totals: ChangedTotals }) {
    const { t, tp } = useTranslation();
    const { totals } = changed;
    const lines = totals.additions + totals.deletions > 0;
    return (
        <>
            <Stat
                value={changedCount(changed)}
                label={tp('changes.filesChanged', totals.files)}
                quiet={totals.files === 0}
            />
            <Stat
                value={
                    lines ? (
                        <TrackedLines additions={totals.additions} deletions={totals.deletions} />
                    ) : (
                        '—'
                    )
                }
                label={t('changes.lines')}
                quiet={!lines}
            />
        </>
    );
}

/** The week of commits, or why the repository could not be read in its place. */
function WeekOrProblem({ folder }: { folder: ProjectFolder }) {
    const summary = useCardSummary(folder);
    const i18n = useTranslation();
    // never started for a card: it says so
    if (
        summary.isError &&
        hasErrorCode(summary.error, 'distro_stopped') &&
        folder?.kind === 'wsl'
    ) {
        return (
            <CardWell>
                <WellMessage>
                    {i18n.t('changes.distroStopped', { distro: folder.distro })}
                </WellMessage>
            </CardWell>
        );
    }
    if (summary.isError) {
        return (
            <CardWell>
                <WellMessage className="text-ui-danger">
                    {projectErrorMessage(summary.error, folder, i18n)}
                </WellMessage>
            </CardWell>
        );
    }
    return summary.data ? (
        <WeekOfCommits sources={[{ folderId: folder.id, head: summary.data.branch.commit }]} />
    ) : null;
}

/**
 * A project of several folders on its card: its folders' names under its name, each repository's
 * branch and changes in their tooltip; the changes of its repositories added up; their commits in
 * one week. A repository that cannot be read is left out here: the top bar tells why.
 */
function SeveralSummary({
    folders,
    part,
}: {
    folders: readonly ProjectFolder[];
    part: PanelSummaryProps['part'];
}) {
    const summaries = useRepositorySummaries(folders);
    const read = summaries.flatMap(({ folder, summary }) =>
        summary.data ? [{ folder, summary: summary.data }] : [],
    );
    const i18n = useTranslation();
    if (part === 'lead') {
        const lines = read.map(({ folder, summary }) =>
            i18n.t('changes.folderLine', {
                name: folderName(folder),
                branch: branchLabel(summary.branch, i18n),
                changes: changedLabel(summary, i18n),
            }),
        );
        return (
            <div className="min-w-0 truncate text-xs text-ui-text-muted" title={lines.join('\n')}>
                {folders.map(folderName).join(', ')}
            </div>
        );
    }
    if (read.length === 0) return null;
    if (part === 'facts') return <Totals totals={summedTotals(read.map((r) => r.summary))} />;
    return (
        <WeekOfCommits
            sources={read.map(({ folder, summary }) => ({
                folderId: folder.id,
                head: summary.branch.commit,
            }))}
        />
    );
}
