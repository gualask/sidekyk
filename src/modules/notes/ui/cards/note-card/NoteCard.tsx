import { IconCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from '@/shared/i18n';
import { CopyIcon } from '@/shared/ui/CopyIcon';
import { type CopyState, copyLabel } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useCanCapture } from '../../../application/captures';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import { useNotesPort } from '../../../application/notes.port';
import { noteMeta } from '../../../model/notes';
import type { Note } from '../../../model/notes.types';
import { DROP_ATTRIBUTE } from '../../use-image-drops';
import { NoteEditor } from './NoteEditor';
import { NoteImages } from './NoteImages';
import { NoteMenu, type NoteOrder } from './NoteMenu';
import { NoteText } from './NoteText';

/**
 * A card: its fill sets it apart from the panel, no border; its border lit while edited or files
 * are dragged over it.
 */
/** At rest; under the pointer a step lighter, its shadow a little deeper: it can be clicked. */
const LOOK =
    'border-transparent bg-ui-surface-raised shadow-[0_1px_2px_var(--ui-shadow-soft)] transition-[background-color,box-shadow] duration-150 hover:bg-ui-surface-raised-hover hover:shadow-[0_2px_8px_var(--ui-shadow-soft)]';
const ACTIVE = 'border-ui-accent bg-ui-surface-raised';
/** Its buttons: shown while the pointer or the focus is on it, or its menu is open. */
const ACTIONS =
    'opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 has-data-popup-open:opacity-100';

/**
 * One note: done on the left (where notes can be done), copy and ⋯ on the right, the text in
 * between, four lines until clicked, its images below. Clicked, the text is edited in place: saved
 * as typing pauses, closed by `Esc`, `⌘↵` or a click outside; emptied, a note without images goes
 * (with Undo). Files dropped on it join its images.
 */
export function NoteCard({
    book,
    note,
    flash,
    editing,
    onEdit,
    actions,
    copied,
    onCopy,
    onDone,
    order,
    onMove,
    dropping,
}: {
    /** The book the note is in. */
    book: string;
    note: Note;
    /** Lit up for a moment: brought into view from the palette. */
    flash: boolean;
    editing: boolean;
    onEdit: (editing: boolean) => void;
    actions: NoteActions;
    copied: CopyState;
    onCopy: () => void;
    /** Marks the note done or open again; null where notes are never done (the Inbox). */
    onDone: ((done: boolean) => void) | null;
    /** For an open note among others: whether it is on top, and the reorder mode to start. */
    order: NoteOrder | null;
    /** Opens the Move dialog for the note. */
    onMove: () => void;
    /** Files are dragged over it. */
    dropping: boolean;
}) {
    const done = note.done !== null;
    const { t } = useTranslation();
    const port = useNotesPort();
    // the capture window opens on the note, its images and text in it
    const capture = useCanCapture()
        ? () =>
              void port.startCapture({
                  kind: 'into',
                  book,
                  target: { kind: 'note', id: note.id },
              })
        : null;

    return (
        <article
            className={`group/card relative flex items-start gap-2.5 rounded-[9px] border py-2 pr-2 pl-2.5 ${
                editing || dropping ? ACTIVE : LOOK
            } ${flash ? 'note-flash' : ''}`}
            aria-label={t('notes.note')}
            {...{ [DROP_ATTRIBUTE]: note.id }}
        >
            {onDone ? <DoneButton done={done} onDone={onDone} /> : null}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {editing ? (
                    <NoteEditor
                        book={book}
                        note={note}
                        actions={actions}
                        onClose={() => onEdit(false)}
                    />
                ) : (
                    <NoteText
                        book={book}
                        text={note.text}
                        done={done}
                        onEdit={() => onEdit(true)}
                    />
                )}
                <NoteImages
                    book={book}
                    note={note}
                    actions={actions}
                    onCapture={editing ? capture : null}
                />
                <CardFoot note={note} editing={editing} copied={copied} onCopy={onCopy}>
                    <NoteMenu
                        order={order}
                        onMove={onMove}
                        onCapture={capture}
                        onDelete={() => void actions.remove(note)}
                    />
                </CardFoot>
            </div>
        </article>
    );
}

/** The round button that marks a note done, or open again. */
function DoneButton({ done, onDone }: { done: boolean; onDone: (done: boolean) => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted ${
                done
                    ? 'border-ui-success bg-ui-success text-ui-surface'
                    : 'border-ui-text-muted text-transparent hover:border-ui-success hover:text-ui-success'
            }`}
            title={t(done ? 'notes.notDone' : 'notes.done')}
            aria-label={t(done ? 'notes.markNotDone' : 'notes.markDone')}
            onClick={() => onDone(!done)}
        >
            <IconCheck size={11} stroke={3} />
        </button>
    );
}

/**
 * When the note was written, and its buttons at the end (copy, then `children`, its menu): the
 * text keeps the card's width. The buttons show while the card is edited, or while the pointer or
 * the focus is on it, or its menu is open (`ACTIONS`).
 */
function CardFoot({
    note,
    editing,
    copied,
    onCopy,
    children,
}: {
    note: Note;
    editing: boolean;
    copied: CopyState;
    onCopy: () => void;
    children: ReactNode;
}) {
    const i18n = useTranslation();
    const copyTitle = copyLabel(copied, i18n.t('notes.copy'), i18n);
    return (
        <div className="flex min-h-4 items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[11.5px] text-ui-text-muted">
                {noteMeta(note, Date.now(), i18n)}
            </div>
            <div className={`-my-1 -mr-1 flex shrink-0 items-center ${editing ? '' : ACTIONS}`}>
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    title={copyTitle}
                    aria-label={copyTitle}
                    onClick={onCopy}
                >
                    <CopyIcon copied={copied} />
                </button>
                {children}
            </div>
        </div>
    );
}
