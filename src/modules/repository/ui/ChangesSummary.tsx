import { hasErrorCode } from '@/shared/errors/app-error';
import type { PanelSummaryProps } from '@/shared/panels/panel';
import { useRepositorySummary } from '../application/repository.queries';
import { projectErrorMessage } from '../model/project-error';
import { changedCount } from '../model/summary';
import { BranchName } from './BranchName';
import { KindBadge } from './KindBadge';
import { LineCounts } from './LineCounts';

/**
 * What Changes tells about a project on its card at all projects: how many files changed, the
 * branch, the lines, and the first files. Loaded with level 0, and read again each time it shows,
 * since all projects is where one looks for the projects with changes.
 */
export function ChangesSummary({ project }: PanelSummaryProps) {
    const summary = useRepositorySummary(project.id, { freshOnShow: true });
    // never started for a card: it says so, in the place of the counts
    if (
        summary.isError &&
        hasErrorCode(summary.error, 'distro_stopped') &&
        project.location.kind === 'wsl'
    ) {
        return (
            <>
                <div className="flex items-center gap-1.5">
                    <span className="inline-flex h-6 items-center rounded-full bg-ui-surface-hover px-2 text-[11px] font-bold text-ui-text-secondary">
                        stopped
                    </span>
                </div>
                <p className="text-xs text-ui-text-muted">
                    {project.location.distro} is not running. Open the project to start it.
                </p>
            </>
        );
    }
    if (summary.isError) {
        return (
            <p className="text-xs text-ui-danger">
                {projectErrorMessage(summary.error, project.location)}
            </p>
        );
    }
    if (!summary.data) return null;
    const { branch, totals, files } = summary.data;
    const more = totals.files - files.length;

    return (
        <>
            <div className="flex flex-wrap items-center gap-1.5">
                <span
                    className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-bold ${
                        totals.files > 0
                            ? 'bg-ui-accent-soft text-ui-accent-on-soft'
                            : 'bg-ui-success-soft text-ui-success-soft-text'
                    }`}
                >
                    {totals.files > 0 ? `${changedCount(summary.data)} changed` : 'clean'}
                </span>
                <span className="chip max-w-56">
                    <BranchName branch={branch} />
                </span>
                {totals.additions + totals.deletions > 0 ? (
                    <span className="chip text-[11.5px]" title="Lines of tracked files">
                        <LineCounts additions={totals.additions} deletions={totals.deletions} />
                    </span>
                ) : null}
            </div>
            {files.length > 0 ? (
                <ul className="flex flex-col gap-1 text-xs">
                    {files.map((file) => (
                        <li key={file.path} className="flex min-w-0 items-center gap-2">
                            <KindBadge kind={file.kind} />
                            <span
                                className="min-w-0 flex-1 truncate font-mono text-[11.5px]"
                                title={file.path}
                            >
                                {file.path}
                            </span>
                            {file.kind === 'untracked' ? null : (
                                <span className="shrink-0 text-[11px]">
                                    <LineCounts
                                        additions={file.additions}
                                        deletions={file.deletions}
                                        binary={file.binary}
                                    />
                                </span>
                            )}
                        </li>
                    ))}
                    {more > 0 ? <li className="text-ui-text-muted">+{more} more</li> : null}
                </ul>
            ) : (
                <p className="text-xs text-ui-text-muted">Working tree clean.</p>
            )}
        </>
    );
}
