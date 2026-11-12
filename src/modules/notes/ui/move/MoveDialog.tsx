import { useRef } from 'react';
import { useTranslation } from '@/shared/i18n';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { PickerDialog, PickerKeys } from '@/shared/ui/PickerDialog';
import { entered, type Move, type MoveRow, type Moving } from '../../model/destination';
import { noteTitle } from '../../model/notes';
import { DestinationField } from '../destination-field/DestinationField';
import { useDestination } from '../destination-field/use-destination';

/**
 * Where a note or a list goes: the destination field (`DestinationField`) under a title. A note
 * picks a book, then one of its lists; a list picks a project. `↵` moves, `Esc` closes. Loaded
 * with its first opening.
 */
export function MoveDialog({
    subject,
    onMove,
    onClose,
}: {
    subject: Moving;
    onMove: (move: Move) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const input = useRef<HTMLInputElement>(null);
    const destination = useDestination(subject);
    const { state, chipNotes } = destination;
    const isNote = subject.kind === 'note';
    /** `↵`: moves where the field says, or makes the suggestion chosen a chip. */
    const enter = (row: MoveRow | null) => {
        const result = entered(subject, state, row, chipNotes);
        if (result?.kind === 'move') {
            onClose();
            onMove(result.move);
        } else if (result?.kind === 'chip') {
            destination.setState(result.state);
            input.current?.focus();
        }
    };
    return (
        <PickerDialog
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title={t(isNote ? 'notes.moveNote' : 'notes.moveList')}
            description={isNote ? noteTitle(subject.note.text) : subject.list.name}
            initialFocus={input}
            width="w-[min(520px,calc(100vw-32px))]"
        >
            <DestinationField
                destination={destination}
                input={input}
                label={t('notes.moveWhere')}
                onEnter={enter}
            />
            <PickerKeys enter={t('notes.moveEnter')}>
                {isNote && !state.chip ? (
                    <span>
                        <KeyHint text={t('notes.moveComplete')} keys={{ tab: 'Tab' }} />
                    </span>
                ) : null}
            </PickerKeys>
        </PickerDialog>
    );
}
