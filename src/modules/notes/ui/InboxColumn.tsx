import { useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { useCaptureMarks } from '../application/captures';
import { useNoteActions } from '../application/note-actions/note-actions';
import { useNotes } from '../application/notes.queries';
import type { Moving } from '../model/destination';
import { openNotes } from '../model/notes';
import { INBOX_BOOK } from '../model/notes.types';
import { CardRows } from './cards/CardRows';
import { NoteCard } from './cards/note-card/NoteCard';
import { useCardRows } from './cards/use-card-rows';
import { useCardStates } from './cards/use-card-states';
import { useRevealedNote } from './cards/use-revealed-note';
import { Composer } from './composer/Composer';
import { MoveHost } from './move/MoveHost';
import { useColumnImages } from './use-image-drops';

/**
 * The column's width until first dragged, a share of the window, and the least it takes: the
 * projects' rows beside it give way first (`ProjectsOverview`).
 */
const INBOX_WIDTH = { initial: '40%', min: 320 };

/**
 * The Inbox at all projects (level 0): whatever comes to mind, put down to be sorted later. A field
 * on top, the notes below, newest first; a note is edited, copied or deleted here, and leaves by
 * being moved or deleted: no lists, no done, no order of its own. Its edge resizes it, as a
 * sidebar's.
 */
export function InboxColumn({
    focusComposer,
    onComposerFocused,
    reveal,
    onRevealed,
}: {
    /** The field to write in takes the focus (`⌘N` at all projects). */
    focusComposer: boolean;
    onComposerFocused: () => void;
    /** A note to bring into view, and light up for a moment (one found in the palette). */
    reveal: string | null;
    onRevealed: () => void;
}) {
    const { data: notes, error } = useNotes(INBOX_BOOK);
    const actions = useNoteActions(INBOX_BOOK);
    const { cardState, edit } = useCardStates(INBOX_BOOK);
    const { marks, end: endMarks } = useCaptureMarks();
    const [moving, setMoving] = useState<Moving | null>(null);
    const width = useSidebarWidth('inbox', INBOX_WIDTH);
    const box = useRef<HTMLElement>(null);
    const { t } = useTranslation();

    // its one list, never shown, made with the Inbox
    const list = notes?.lists[0];
    const shown = useMemo(
        () => (notes && list ? openNotes(notes.notes, list.id) : []),
        [notes, list],
    );
    const rows = useCardRows(shown.length, (index) => shown[index].id);
    const images = useColumnImages({
        root: box,
        book: INBOX_BOOK,
        actions,
        list: list?.id ?? '',
        onAdded: (note) => {
            rows.virtualizer.scrollToOffset(0);
            // a note of images alone opens, for its text
            if (note.text === '') edit(note.id);
        },
    });
    // once the notes are read: before, the note asked for has no row yet
    const flash = useRevealedNote({
        reveal: notes ? reveal : null,
        index: shown.findIndex((note) => note.id === reveal),
        virtualizer: rows.virtualizer,
        onRevealed,
    });

    return (
        <>
            <section
                ref={box}
                aria-label={t('inbox.title')}
                className="flex flex-col bg-ui-surface font-sans"
                style={{ ...width.style, minWidth: INBOX_WIDTH.min }}
            >
                <InboxHead error={error} />
                {list ? (
                    <>
                        <Composer
                            book={INBOX_BOOK}
                            focus={focusComposer}
                            onFocused={onComposerFocused}
                            placeholder={t('notes.composer')}
                            label={t('inbox.newNote')}
                            hint={shown.length === 0 ? t('inbox.empty') : null}
                            {...images.composer}
                        />
                        <CardRows rows={rows}>
                            {(index) => {
                                const note = shown[index];
                                return (
                                    <NoteCard
                                        book={INBOX_BOOK}
                                        note={note}
                                        flash={flash === note.id}
                                        actions={actions}
                                        {...cardState(note)}
                                        onDone={null}
                                        order={null}
                                        dropping={images.overCard === note.id}
                                        marks={marks}
                                        place={t('inbox.title')}
                                        onMarked={endMarks}
                                        onMove={() =>
                                            setMoving({ kind: 'note', book: INBOX_BOOK, note })
                                        }
                                    />
                                );
                            }}
                        </CardRows>
                    </>
                ) : null}
            </section>
            <MoveHost moving={moving} actions={actions} onClose={() => setMoving(null)} />
            {/* nothing to fit: the notes wrap; a double click goes back to the share of the window */}
            <SidebarSplitter
                width={width}
                box={box}
                place="edge"
                fitting={() => null}
                what="inbox"
            />
        </>
    );
}

/** The column's title, what it is for, and why its notes could not be read, if so. */
function InboxHead({ error }: { error: unknown }) {
    const i18n = useTranslation();
    const { t } = i18n;
    return (
        <>
            <header className="px-4 pt-3.5 pb-1">
                <h2 className="text-[15px] font-bold">{t('inbox.title')}</h2>
                <p className="text-xs text-ui-text-muted">{t('inbox.what')}</p>
            </header>
            {error ? (
                <p className="px-4 py-2 text-sm text-ui-danger">{errorMessage(error, i18n)}</p>
            ) : null}
        </>
    );
}
