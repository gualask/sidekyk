import { hasErrorCode } from '@/shared/errors/app-error';
import type { PanelSummaryProps } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { Stat } from '@/shared/ui/Stat';
import { useRepositorySummary } from '../application/repository.queries';
import { projectErrorMessage } from '../model/project-error';
import { changedCount } from '../model/summary';
import { BranchName } from './BranchName';
import { CardWell, WellMessage } from './CardWell';
import { TrackedLines } from './LineCounts';
import { WeekOfCommits } from './WeekOfCommits';

/**
 * What Changes tells about a project on its card at all projects: the branch under its name, how
 * many files and lines changed among the card's numbers (quiet when clean, so that the projects at
 * work stand out), and the lines committed day by day in the last week below, or why the
 * repository could not be read. Loaded with level 0; the summary is read again each time it shows,
 * since all projects is where one looks for the projects with changes.
 */
export function ChangesSummary({ project, part }: PanelSummaryProps) {
    if (part === 'lead') return <BranchLine project={project} />;
    if (part === 'facts') return <Counts project={project} />;
    return <WeekOrProblem project={project} />;
}

/** One summary for the three parts: read once, each time the card shows. */
function useCardSummary(project: ProjectInfo) {
    return useRepositorySummary(project.id, { freshOnShow: true });
}

function BranchLine({ project }: { project: ProjectInfo }) {
    const summary = useCardSummary(project);
    if (!summary.data) return null;
    return (
        <div className="flex min-w-0 text-xs text-ui-text-muted">
            <BranchName branch={summary.data.branch} className="text-[11.5px]" />
        </div>
    );
}

function Counts({ project }: { project: ProjectInfo }) {
    const summary = useCardSummary(project);
    if (!summary.data) return null;
    const { totals } = summary.data;
    const lines = totals.additions + totals.deletions > 0;
    return (
        <>
            <Stat
                value={changedCount(summary.data)}
                label={totals.files === 1 ? 'file changed' : 'files changed'}
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
                label="lines"
                quiet={!lines}
            />
        </>
    );
}

/** The week of commits, or why the repository could not be read in its place. */
function WeekOrProblem({ project }: { project: ProjectInfo }) {
    const summary = useCardSummary(project);
    // never started for a card: it says so
    if (
        summary.isError &&
        hasErrorCode(summary.error, 'distro_stopped') &&
        project.location.kind === 'wsl'
    ) {
        return (
            <CardWell>
                <WellMessage>
                    {project.location.distro} is not running. Open the project to start it.
                </WellMessage>
            </CardWell>
        );
    }
    if (summary.isError) {
        return (
            <CardWell>
                <WellMessage className="text-ui-danger">
                    {projectErrorMessage(summary.error, project.location)}
                </WellMessage>
            </CardWell>
        );
    }
    return summary.data ? (
        <WeekOfCommits projectId={project.id} head={summary.data.branch.commit} />
    ) : null;
}
