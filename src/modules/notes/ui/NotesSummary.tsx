import type { PanelSummaryProps } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { Stat } from '@/shared/ui/Stat';
import { useNotesSummary } from '../application/notes.queries';

/** What Notes tells about a project on its card at all projects: how many notes wait. */
export function NotesSummary({ project, part }: PanelSummaryProps) {
    return part === 'facts' ? <NotesCount project={project} /> : null;
}

function NotesCount({ project }: { project: ProjectInfo }) {
    const summary = useNotesSummary(project.id).data;
    if (!summary) return null;
    return (
        <Stat
            value={summary.open}
            label={summary.open === 1 ? 'note' : 'notes'}
            quiet={summary.open === 0}
        />
    );
}
