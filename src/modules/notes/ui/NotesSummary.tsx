import { useTranslation } from '@/shared/i18n';
import type { PanelSummaryProps } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { dayAgo } from '@/shared/time/relative-time';
import { CardWell, WellMessage } from '@/shared/ui/CardWell';
import { Stat } from '@/shared/ui/Stat';
import { useNotesSummary } from '../application/notes.queries';

/**
 * What Notes tells about a project on its card at all projects: beside a repository's numbers, how
 * many notes wait. A project without folder, or with a folder without git, has nothing else to
 * count: its notes fill the card, how many wait and how many are done, and when they last changed.
 */
export function NotesSummary({ project, part, repository }: PanelSummaryProps) {
    const alone = !repository;
    if (part === 'facts') return <Counts project={project} alone={alone} />;
    if (part === 'body' && alone) return <LastChange project={project} />;
    return null;
}

function Counts({ project, alone }: { project: ProjectInfo; alone: boolean }) {
    const summary = useNotesSummary(project.id).data;
    const { tp } = useTranslation();
    if (!summary) return null;
    const { open, done } = summary;
    return (
        <>
            <Stat
                value={open}
                label={tp(alone ? 'notes.waiting' : 'notes.stat', open)}
                quiet={open === 0}
            />
            {alone ? (
                <Stat value={done} label={tp('notes.doneStat', done)} quiet={done === 0} />
            ) : null}
        </>
    );
}

function LastChange({ project }: { project: ProjectInfo }) {
    const summary = useNotesSummary(project.id).data;
    const { t, formatTag } = useTranslation();
    if (!summary) return null;
    const { lastEdited } = summary;
    return (
        <CardWell>
            <WellMessage>
                {lastEdited === null
                    ? t('notes.noneYet')
                    : t('notes.lastChange', { when: dayAgo(lastEdited, Date.now(), formatTag) })}
            </WellMessage>
        </CardWell>
    );
}
