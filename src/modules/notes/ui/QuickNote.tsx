import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from '@/shared/i18n';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { type NoteActions, useNoteActions } from '../application/note-actions/note-actions';
import { useNotes } from '../application/notes.queries';
import { useNotesSettings } from '../application/notes-settings';
import { type MoveSubject, moveOf, picked } from '../model/destination';
import { INBOX_BOOK, type Note } from '../model/notes.types';
import { PendingList } from './composer/Composer';
import { useNoteDraft } from './composer/use-note-draft';
import { DestinationField } from './destination-field/DestinationField';
import { useChoice } from './destination-field/use-choice';
import { useDestination } from './destination-field/use-destination';
import { linesClass, wrapLines } from './notes-layout';
import { useColumnImages } from './use-image-drops';

/** What the quick note writes: a new note, for the Inbox unless its destination says otherwise. */
const NEW_NOTE: MoveSubject = { kind: 'new' };

/**
 * The quick note: the window shrunk to a field for a note, over any app, and below it where the
 * note goes, the Inbox unless changed: Move's destination field (`DestinationField`), its
 * suggestions above it. `↵` in the note adds it and closes, as a paste into the empty note does;
 * images pasted or dropped after text wait for `↵`. `Tab` goes to the destination, `⇧Tab` back;
 * there `↵` on a suggestion makes it a chip, as `Tab`, and without one adds the note; `Esc` puts
 * the destination back as it was. A note goes into the Inbox, then where its destination says,
 * as Move moves it (a list to make is made there). `Esc` in the note closes, keeping what was
 * typed and where it goes for the next time; a note added starts the next one for the Inbox. In
 * a window larger than itself (full screen) it sits in the middle.
 */
export function QuickNote({ open, onDone }: { open: boolean; onDone: () => void }) {
    const { t } = useTranslation();
    const { data: notes } = useNotes(INBOX_BOOK);
    const actions = useNoteActions(INBOX_BOOK);
    const settings = useNotesSettings();
    const box = useRef<HTMLElement>(null);
    const field = useRef<HTMLTextAreaElement>(null);
    const where = useRef<HTMLInputElement>(null);
    const destination = useDestination(NEW_NOTE);
    const { state, setState, reset } = destination;
    const { choosing, start, end, restore } = useChoice(open, destination);
    // the Inbox's one list, made with it
    const list = notes?.lists[0]?.id;
    const draft = useInboxDraft(box, field, actions, list, (note) => {
        // the destination as it was when the note was sent
        const move = moveOf(NEW_NOTE, state, undefined);
        if (move) void actions.moveNote(note, move, { added: true });
        reset();
        onDone();
    });
    // long lines wrap or not as the setting says (`⌥Z` switches it); the field keeps its height
    useLayoutEffect(() => wrapLines(field.current, settings.lines), [settings.lines]);
    useEffect(() => {
        if (open) field.current?.focus();
    }, [open]);
    /** A key in the note: `Esc` closes, `Tab` goes to the destination, the rest is the draft's. */
    const noteKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
            return;
        }
        // to the destination, past the images waiting
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
        if (event.key === 'Tab' && plain && !event.shiftKey) {
            event.preventDefault();
            where.current?.focus();
            return;
        }
        draft.field.onKeyDown(event);
    };

    return (
        <main
            className={`h-screen w-screen items-center justify-center bg-ui-bg font-sans ${
                open ? 'flex' : 'hidden'
            }`}
            // the layout, hidden under the note, keeps its window keys: the note's are its own
            onKeyDown={(event) => event.stopPropagation()}
        >
            {/* the window's size as the backend makes it (`compact_frame.rs`), for a larger one */}
            <section
                ref={box}
                className="flex h-[min(100vh,168px)] w-full max-w-[560px] flex-col bg-ui-surface min-[600px]:rounded-xl"
            >
                <div className="flex min-h-0 flex-1 flex-col px-4 pt-3.5 pb-2">
                    <textarea
                        ref={field}
                        spellCheck={false}
                        placeholder={t('quickNote.placeholder')}
                        aria-label={t('shortcuts.newNote')}
                        className={`min-h-0 flex-1 resize-none bg-transparent text-[15px]/[1.5] text-ui-text outline-none placeholder:text-ui-text-muted ${linesClass(settings.lines)}`}
                        {...draft.field}
                        onKeyDown={noteKey}
                    />
                    <PendingList pending={draft.pending} onDrop={draft.dropPending} />
                </div>
                <div className="dialog-foot items-center py-2">
                    <DestinationField
                        destination={destination}
                        input={where}
                        label={t('notes.moveWhere')}
                        popup={choosing}
                        place="min-w-0 flex-1"
                        onFocus={start}
                        onBlur={end}
                        onEnter={(row) => {
                            // a suggestion chosen becomes a chip, as with Tab
                            if (row) {
                                setState(picked(state, row));
                                return;
                            }
                            if (!state.chip) return;
                            // a note written goes; else it is written next, there
                            if (draft.written) draft.submit();
                            else field.current?.focus();
                        }}
                        onEscape={() => {
                            restore();
                            field.current?.focus();
                        }}
                    />
                    <QuickNoteKeys choosing={choosing} />
                </div>
            </section>
        </main>
    );
}

/**
 * The note being written for the Inbox's list (`list`, once read), its images pasted or dropped
 * on `box`; added, `onAdded` takes it. Until the Inbox is read, a note has nowhere to go: it waits
 * in the field.
 */
function useInboxDraft(
    box: RefObject<HTMLElement | null>,
    field: RefObject<HTMLTextAreaElement | null>,
    actions: NoteActions,
    list: string | undefined,
    onAdded: (note: Note) => void,
) {
    const images = useColumnImages({
        root: box,
        book: INBOX_BOOK,
        actions,
        list: list ?? '',
        onAdded,
    });
    return useNoteDraft({
        field,
        onAdd: (text, pending) =>
            list
                ? images.composer.onAdd(text, pending)
                : Promise.resolve({ added: false, left: [...pending] }),
        pasted: images.composer.pasted,
        dropInto: images.composer.dropInto,
    });
}

/** The keys the quick note takes, as the focus is in the note or on its destination. */
function QuickNoteKeys({ choosing }: { choosing: boolean }) {
    const { t } = useTranslation();
    if (choosing) {
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
    return (
        <>
            <span>
                <KeyHint text={t('quickNote.add')} keys={{ enter: 'Enter' }} />
            </span>
            <span>
                <KeyHint text={t('quickNote.newLine')} keys={{ keys: 'Shift+Enter' }} />
            </span>
            <span>
                <KeyHint text={t('quickNote.where')} keys={{ tab: 'Tab' }} />
            </span>
            <span>
                <KeyHint text={t('common.escCloses')} keys={{ esc: 'Escape' }} />
            </span>
        </>
    );
}
