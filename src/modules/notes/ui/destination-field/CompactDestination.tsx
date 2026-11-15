import type { RefObject } from 'react';
import { useTranslation } from '@/shared/i18n';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { picked } from '../../model/destination';
import { DestinationField } from './DestinationField';
import type { Choice } from './use-choice';
import type { Destination } from './use-destination';

/**
 * The destination field in a compact window's bar (the quick note, the capture window), its
 * suggestions in a popup above it while it is chosen: `↵` on a suggestion makes it a chip, as
 * `Tab`; without one, with a book chosen, `onWrite`; `Esc` puts the destination back as it was,
 * then `onBack` (to the note).
 */
export function CompactDestination({
    destination,
    choice,
    input,
    onWrite,
    onBack,
}: {
    destination: Destination;
    choice: Choice;
    input: RefObject<HTMLInputElement | null>;
    onWrite: () => void;
    onBack: () => void;
}) {
    const { t } = useTranslation();
    return (
        <DestinationField
            destination={destination}
            input={input}
            label={t('notes.moveWhere')}
            popup={choice.choosing}
            place="min-w-0 flex-1"
            onFocus={choice.start}
            onBlur={choice.end}
            onEnter={(row) => {
                if (row) destination.setState(picked(destination.state, row));
                else if (destination.state.chip) onWrite();
            }}
            onEscape={() => {
                choice.restore();
                onBack();
            }}
        />
    );
}

/** The keys a compact window takes while its destination is chosen. */
export function ChoosingKeys() {
    const { t } = useTranslation();
    return (
        <>
            <span>
                <KeyHint
                    text={t('common.keysChoose')}
                    keys={{ up: 'ArrowUp', down: 'ArrowDown' }}
                />
            </span>
            <span>
                <KeyHint text={t('notes.moveComplete')} keys={{ tab: 'Tab' }} />
            </span>
            <span>
                <KeyHint text={t('quickNote.add')} keys={{ enter: 'Enter' }} />
            </span>
            <span>
                <KeyHint text={t('quickNote.back')} keys={{ esc: 'Escape' }} />
            </span>
        </>
    );
}
