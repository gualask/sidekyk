import type { PanelSummaryProps } from '@/shared/panels/panel';
import { useNotesSummary } from '../application/notes.queries';

/**
 * What Notes tells about a project on its card at all projects: how many notes wait, and the
 * newest. Loaded with level 0.
 */
export function NotesSummary({ project }: PanelSummaryProps) {
    const summary = useNotesSummary(project.root).data;
    if (!summary) return null;
    return (
        <p className="mt-auto line-clamp-2 border-t border-dashed border-ui-border pt-2.5 text-xs text-ui-text-muted">
            {summary.open === 0 ? (
                'No notes yet'
            ) : (
                <>
                    <b className="font-semibold text-ui-text-secondary">
                        {summary.open} {summary.open === 1 ? 'note' : 'notes'}
                    </b>
                    <br />
                    {summary.newest}
                </>
            )}
        </p>
    );
}
