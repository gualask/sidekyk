import { lazy, Suspense } from 'react';
import type { NoteActions } from '../application/notes.queries';
import type { MoveSubject } from '../model/move-dialog';

const MoveDialog = lazy(() =>
    import('./MoveDialog').then((module) => ({ default: module.MoveDialog })),
);

/** The Move dialog while something is being moved, which `actions` then moves. */
export function MoveHost({
    moving,
    actions,
    onClose,
}: {
    moving: MoveSubject | null;
    actions: NoteActions;
    onClose: () => void;
}) {
    if (!moving) return null;
    return (
        <Suspense fallback={null}>
            <MoveDialog
                subject={moving}
                onClose={onClose}
                onMove={(move) =>
                    moving.kind === 'note'
                        ? void actions.moveNote(moving.note, move)
                        : void actions.moveList(moving.list.id, move)
                }
            />
        </Suspense>
    );
}
