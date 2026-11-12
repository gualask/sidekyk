import type { ReactNode } from 'react';
import { hasErrorCode } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { PanelSummaryProps } from '@/shared/panels/panel';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { folderName, remoteMachine } from '@/shared/projects/project-place';
import { useRepositorySummaries, useRepositorySummary } from '../../application/queries/snapshot';
import { branchLabel } from '../../model/history/branch';
import { type ChangedTotals, changedLabel, summedTotals } from '../../model/history/summary';
import { projectErrorMessage } from '../../model/project-error';
import { LineCounts } from '../LineCounts';
import { BranchName } from './BranchName';
import { WeekOfCommits } from './WeekOfCommits';

/**
 * What Changes tells about a project on its row at all projects: under its name the branch and
 * the lines not committed beside it (nothing when clean, so that the projects at work stand out),
 * or why the repository could not be read; at its end the week of commits. Loaded with
 * level 0; the summary is read again each time it shows, since all projects is where one looks
 * for the projects with changes.
 */
export function ChangesSummary({ project, folder, part }: PanelSummaryProps) {
    if (project.folders.length > 1) return <SeveralSummary folders={project.folders} part={part} />;
    // a repository's summary: only a project with a folder has one
    if (!folder) return null;
    return part === 'lead' ? <BranchOrProblem folder={folder} /> : <Week folder={folder} />;
}

/** One summary for every part: read once, each time the row shows. */
function useRowSummary(folder: ProjectFolder) {
    return useRepositorySummary(folder.id, { freshOnShow: true });
}

/** The branch and the lines not committed on it, or why the repository could not be read. */
function BranchOrProblem({ folder }: { folder: ProjectFolder }) {
    const summary = useRowSummary(folder);
    const i18n = useTranslation();
    // never started for a row: it says so
    const distro = remoteMachine(folder);
    if (summary.isError && hasErrorCode(summary.error, 'distro_stopped') && distro) {
        return <Lead>{i18n.t('changes.distroStopped', { distro })}</Lead>;
    }
    if (summary.isError) {
        const message = projectErrorMessage(summary.error, folder, i18n);
        return (
            <Lead className="text-ui-danger" title={message}>
                {message}
            </Lead>
        );
    }
    if (!summary.data) return null;
    return (
        <LeadLine>
            <BranchName branch={summary.data.branch} className="text-[11.5px]" />
            <Changed totals={summary.data} />
        </LeadLine>
    );
}

/** The line under the row's name: what the repository is (cut first), then its changes. */
function LeadLine({ children }: { children: ReactNode }) {
    return <div className="flex min-w-0 items-center gap-3 text-ui-text-muted">{children}</div>;
}

/** A line of text under the row's name, cut to fit. */
function Lead({
    className = 'text-ui-text-muted',
    title,
    children,
}: {
    className?: string;
    title?: string;
    children: string;
}) {
    return (
        <div className={`min-w-0 truncate text-xs ${className}`} title={title}>
            {children}
        </div>
    );
}

/** The week of commits of the branch, once the repository is read. */
function Week({ folder }: { folder: ProjectFolder }) {
    const summary = useRowSummary(folder);
    if (!summary.data) return null;
    return <WeekOfCommits sources={[{ folderId: folder.id, head: summary.data.branch.commit }]} />;
}

/**
 * The lines not committed in tracked files, said so; files changed without lines counted (new
 * files alone, a binary) say how many, so a row with changes never reads as clean. Nothing when
 * clean.
 */
function Changed({ totals: changed }: { totals: ChangedTotals }) {
    const i18n = useTranslation();
    const { totals } = changed;
    if (totals.additions + totals.deletions > 0) {
        return (
            <span className="inline-flex shrink-0 items-baseline gap-1.5 text-xs">
                <LineCounts additions={totals.additions} deletions={totals.deletions} compact />
                <span>{i18n.t('changes.uncommitted')}</span>
            </span>
        );
    }
    if (totals.files === 0) return null;
    return <span className="shrink-0 text-xs">{changedLabel(changed, i18n)}</span>;
}

/**
 * A project of several folders on its row: under its name its folders' names, each repository's
 * branch and changes in their tooltip, and the lines not committed in all of them; their commits
 * in one week. A repository that cannot be read is left out here: the top bar tells why.
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
            <LeadLine>
                <Lead title={lines.join('\n')}>{folders.map(folderName).join(', ')}</Lead>
                {read.length > 0 ? (
                    <Changed totals={summedTotals(read.map((r) => r.summary))} />
                ) : null}
            </LeadLine>
        );
    }
    if (read.length === 0) return null;
    return (
        <WeekOfCommits
            sources={read.map(({ folder, summary }) => ({
                folderId: folder.id,
                head: summary.branch.commit,
            }))}
        />
    );
}
