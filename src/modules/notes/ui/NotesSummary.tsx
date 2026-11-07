import { useTranslation } from '@/shared/i18n';
import type { PanelSummaryProps } from '@/shared/panels/panel';
import { useOpenNotes } from '../application/notes.queries';

/**
 * What Notes tells about a project on its row at all projects: at the row's end, how many notes
 * are open, where a repository shows its week of commits. Nothing beside a repository.
 */
export function NotesSummary({ project, part, repository }: PanelSummaryProps) {
    if (part !== 'end' || repository) return null;
    return <OpenNotes book={project.id} />;
}

function OpenNotes({ book }: { book: string }) {
    const open = useOpenNotes(book).data;
    const { tp } = useTranslation();
    if (open === undefined) return null;
    return (
        <p
            className={`text-right text-xs ${open > 0 ? 'text-ui-text-secondary' : 'text-ui-text-muted'}`}
        >
            {tp('notes.openCount', open)}
        </p>
    );
}
