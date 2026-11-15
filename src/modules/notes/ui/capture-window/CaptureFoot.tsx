import type { RefObject } from 'react';
import { useTranslation } from '@/shared/i18n';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { useNotes } from '../../application/notes.queries';
import type { CaptureDraft } from '../../model/capture-draft';
import { noteTitle } from '../../model/notes';
import { ChoosingKeys, CompactDestination } from '../destination-field/CompactDestination';
import type { Choice } from '../destination-field/use-choice';
import type { Destination } from '../destination-field/use-destination';

/**
 * Below the draft, where its note goes: the note it adds to, or the destination field
 * (`CompactDestination`); then the keys the window takes.
 */
export function CaptureFoot({
    draft,
    destination,
    choice,
    where,
    onWrite,
    onText,
}: {
    draft: CaptureDraft;
    destination: Destination;
    choice: Choice;
    /** The destination field. */
    where: RefObject<HTMLInputElement | null>;
    onWrite: () => void;
    /** Back to the draft's text. */
    onText: () => void;
}) {
    const goes = draft.destination;
    return (
        <div className="dialog-foot items-center py-2">
            {goes.kind === 'note' ? (
                <NoteName book={goes.book} id={goes.note} />
            ) : (
                <CompactDestination
                    destination={destination}
                    choice={choice}
                    input={where}
                    onWrite={onWrite}
                    onBack={onText}
                />
            )}
            <CaptureKeys choosing={choice.choosing} where={goes.kind === 'place'} />
        </div>
    );
}

/** The note a draft adds to, by its title. */
function NoteName({ book, id }: { book: string; id: string }) {
    const { t } = useTranslation();
    const { data } = useNotes(book);
    const note = data?.notes.find((held) => held.id === id);
    return (
        <span className="min-w-0 flex-1 truncate text-xs text-ui-text-secondary">
            {t('notes.captureInto', { title: note ? noteTitle(note.text) : '' })}
        </span>
    );
}

/**
 * The keys the capture window takes, as the focus is in the draft or on its destination (`where`:
 * a field to choose it).
 */
function CaptureKeys({ choosing, where }: { choosing: boolean; where: boolean }) {
    const { t } = useTranslation();
    if (choosing) return <ChoosingKeys />;
    return (
        <>
            <span>
                <KeyHint text={t('quickNote.add')} keys={{ enter: 'Enter' }} />
            </span>
            <span>
                <KeyHint text={t('notes.captureKeys')} keys={{ keys: 'Mod+Enter' }} />
            </span>
            {where ? (
                <span>
                    <KeyHint text={t('quickNote.where')} keys={{ tab: 'Tab' }} />
                </span>
            ) : null}
            <span>
                <KeyHint text={t('common.escCloses')} keys={{ esc: 'Escape' }} />
            </span>
        </>
    );
}
