import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { notesKey, useExportNotes, useNotesCount } from '../application/notes.queries';

/**
 * Removing a project deletes its notes: with none, it goes at once; with some, this asks first,
 * to export them (then remove) or to delete them with it. Nothing is left on disk without the
 * project. Loaded with the first removal.
 */
export function RemoveProjectDialog({
    project,
    onRemove,
    onClose,
}: {
    project: ProjectInfo;
    /** Removes the project, its notes with it. */
    onRemove: () => void;
    onClose: () => void;
}) {
    const client = useQueryClient();
    const exportNotes = useExportNotes(project.id);
    const [exporting, setExporting] = useState(false);
    const count = useNotesCount(project.id);
    const { t, tp } = useTranslation();

    const remove = useEffectEvent(() => {
        // what was read of its notes goes too: added again, it starts with none
        client.removeQueries({ queryKey: notesKey(project.id) });
        onRemove();
        onClose();
    });
    // none to lose: it goes at once
    useEffect(() => {
        if (count.data === 0) remove();
    }, [count.data]);

    // asked whenever notes may be lost: counted, or not countable
    const notes = count.data ?? null;
    return (
        <AlertDialog.Root
            open={(notes !== null && notes > 0) || count.isError}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <AlertDialog.Portal>
                <AlertDialog.Backdrop className="dialog-backdrop" />
                <AlertDialog.Popup className="dialog-popup top-[22vh] w-[min(440px,calc(100vw-32px))] p-4">
                    <AlertDialog.Title className="text-[15px] font-bold">
                        {t('remove.title', { name: project.name })}
                    </AlertDialog.Title>
                    <AlertDialog.Description className="mt-1.5 text-ui-text-secondary">
                        {notes === null ? t('remove.notes') : tp('remove.notesCount', notes)}
                        {/* a project without folder has no repository to leave as it is */}
                        {projectFolder(project) ? ` ${t('remove.folderStays')}` : null}
                    </AlertDialog.Description>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <AlertDialog.Close className="btn-ghost-sm">
                            {t('common.cancel')}
                        </AlertDialog.Close>
                        <button
                            type="button"
                            className="btn-ghost-sm"
                            disabled={exporting}
                            onClick={async () => {
                                setExporting(true);
                                const path = await exportNotes();
                                setExporting(false);
                                if (path) remove();
                            }}
                        >
                            {t('notes.export')}
                        </button>
                        <button
                            type="button"
                            className="btn-ghost-sm text-ui-danger hover:bg-ui-danger-soft hover:text-ui-danger-soft-text"
                            disabled={exporting}
                            onClick={remove}
                        >
                            {t('remove.confirm')}
                        </button>
                    </div>
                </AlertDialog.Popup>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
}
