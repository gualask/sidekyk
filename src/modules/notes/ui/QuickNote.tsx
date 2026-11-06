import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { useNoteActions, useNotes } from '../application/notes.queries';
import { useNotesSettings } from '../application/notes-settings';
import { type MoveState, type MoveSubject, moveOf, picked, settled } from '../model/destination';
import { INBOX_BOOK } from '../model/notes.types';
import { PendingList } from './Composer';
import { DestinationField } from './DestinationField';
import { linesClass, wrapLines } from './notes-layout';
import { useDestination } from './use-destination';
import { useColumnImages } from './use-image-drops';
import { useNoteDraft } from './use-note-draft';

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
    const { state, setState, chipNotes, reset } = destination;
    // the destination field has the focus; what it was when it took it, for `Esc`
    const [choosing, setChoosing] = useState(false);
    const before = useRef<MoveState>(state);
    // closing the note ends a choice in progress: a field hidden with the focus may never say it
    // lost it (the shortcut closes the note from anywhere)
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (!open) setChoosing(false);
    }
    // the Inbox's one list, made with it
    const list = notes?.lists[0]?.id;
    const images = useColumnImages({
        root: box,
        book: INBOX_BOOK,
        actions,
        list: list ?? '',
        onAdded: (note) => {
            // the destination as it was when the note was sent
            const move = moveOf(NEW_NOTE, state, undefined);
            if (move) void actions.moveNote(note, move, { added: true });
            reset();
            onDone();
        },
    });
    const draft = useNoteDraft({
        field,
        // until the Inbox is read, a note has nowhere to go: it waits in the field
        onAdd: (text, pending) =>
            list
                ? images.composer.onAdd(text, pending)
                : Promise.resolve({ added: false, left: [...pending] }),
        pasted: images.composer.pasted,
        dropInto: images.composer.dropInto,
    });
    // long lines wrap or not as the setting says (`⌥Z` switches it); the field keeps its height
    useLayoutEffect(() => wrapLines(field.current, settings.lines), [settings.lines]);
    useEffect(() => {
        if (open) field.current?.focus();
    }, [open]);
    // a destination left half chosen: back as it was, or a project with the list it opens on
    useEffect(() => {
        if (choosing) return;
        const next = settled(state, before.current, chipNotes);
        if (next !== state) setState(next);
    }, [choosing, state, chipNotes, setState]);

    return (
        <main
            className={`h-screen w-screen items-center justify-center bg-ui-bg font-sans ${
                open ? 'flex' : 'hidden'
            }`}
            // the layout, hidden under the note, keeps its window keys: the note's are its own
            onKeyDown={(event) => event.stopPropagation()}
        >
            {/* the window's size as the backend makes it (`quick_note.rs`), for a larger one */}
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
                        onKeyDown={(event) => {
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
                        }}
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
                        onFocus={() => {
                            before.current = state;
                            setChoosing(true);
                        }}
                        onBlur={() => setChoosing(false)}
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
                            setState(before.current);
                            field.current?.focus();
                        }}
                    />
                    {choosing ? (
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
                    ) : (
                        <>
                            <span>
                                <KeyHint text={t('quickNote.add')} keys={{ enter: 'Enter' }} />
                            </span>
                            <span>
                                <KeyHint
                                    text={t('quickNote.newLine')}
                                    keys={{ keys: 'Shift+Enter' }}
                                />
                            </span>
                            <span>
                                <KeyHint text={t('quickNote.where')} keys={{ tab: 'Tab' }} />
                            </span>
                            <span>
                                <KeyHint text={t('common.escCloses')} keys={{ esc: 'Escape' }} />
                            </span>
                        </>
                    )}
                </div>
            </section>
        </main>
    );
}
