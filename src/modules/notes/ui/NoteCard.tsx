import { Menu } from '@base-ui/react/menu';
import { IconCheck, IconDots, IconTrash } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { CopyIcon } from '@/shared/ui/CopyIcon';
import { type CopyState, copyLabel } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { NoteActions, PendingMarks } from '../application/notes.queries';
import { onNoteFieldKey, useNotesSettings } from '../application/notes-settings';
import { noteMeta } from '../model/notes';
import type { Note } from '../model/notes.types';
import { NoteImages } from './NoteImages';
import { NoteText } from './NoteText';
import { autosize, fitLines, linesClass } from './notes-layout';
import { DROP_ATTRIBUTE } from './use-image-drops';
import { useReferenceField } from './use-reference-field';

/** How long typing pauses before the text is saved; closing the card saves at once. */
const SAVE_DELAY_MS = 500;

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
    marks,
    place,
    onMarked,
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
    order: { top: boolean; moveToTop: () => void; reorder: () => void } | null;
    /** Opens the Move dialog for the note. */
    onMove: () => void;
    /** Files are dragged over it. */
    dropping: boolean;
    /**
     * A capture's marks waiting for their card, which opens them if they are this note's; then
     * the note opens for its text, unless the capture was discarded.
     */
    marks: PendingMarks | null;
    /** Where the note is, as the capture's marks name it: the project's name, the Inbox. */
    place: string;
    /** The capture's marks ended. */
    onMarked: () => void;
}) {
    const done = note.done !== null;
    const i18n = useTranslation();
    const { t } = i18n;
    const copyTitle = copyLabel(copied, t('notes.copy'), i18n);

    return (
        <article
            className={`group/card relative flex items-start gap-2.5 rounded-[9px] border bg-ui-surface-subtle py-2 pr-1.5 pl-2.5 ${
                editing || dropping
                    ? 'border-ui-accent'
                    : 'border-ui-border hover:border-ui-border-hover'
            } ${flash ? 'note-flash' : ''}`}
            aria-label={t('notes.note')}
            {...{ [DROP_ATTRIBUTE]: note.id }}
        >
            {onDone ? (
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
            ) : null}
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
                    annotate={marks?.note === note.id ? marks.image : null}
                    place={place}
                    onAnnotated={(kept) => {
                        onMarked();
                        if (kept) onEdit(true);
                    }}
                />
                <div className="text-[11.5px] text-ui-text-muted">
                    {noteMeta(note, Date.now(), i18n)}
                </div>
            </div>
            <div className="-mt-0.5 -mr-0.5 flex shrink-0 items-start">
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    title={copyTitle}
                    aria-label={copyTitle}
                    onClick={onCopy}
                >
                    <CopyIcon copied={copied} />
                </button>
                <Menu.Root>
                    <Menu.Trigger
                        className="btn-icon h-6 w-6 data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text"
                        title={t('common.more')}
                        aria-label={t('notes.moreForNote')}
                    >
                        <IconDots size={14} />
                    </Menu.Trigger>
                    <Menu.Portal>
                        <Menu.Positioner sideOffset={4} align="end">
                            <Menu.Popup className="menu-popup w-[200px]">
                                {order ? (
                                    <>
                                        {order.top ? null : (
                                            <Menu.Item
                                                className="menu-item"
                                                onClick={order.moveToTop}
                                            >
                                                {t('notes.moveToTop')}
                                            </Menu.Item>
                                        )}
                                        <Menu.Item className="menu-item" onClick={order.reorder}>
                                            {t('notes.reorder')}
                                        </Menu.Item>
                                        <Menu.Separator className="mx-1.5 my-1 h-px bg-ui-border" />
                                    </>
                                ) : null}
                                <Menu.Item className="menu-item" onClick={onMove}>
                                    {t('notes.move')}
                                </Menu.Item>
                                <Menu.Separator className="mx-1.5 my-1 h-px bg-ui-border" />
                                <Menu.Item
                                    className="menu-item danger"
                                    onClick={() => void actions.remove(note)}
                                >
                                    <IconTrash size={14} />
                                    {t('notes.delete')}
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            </div>
        </article>
    );
}

/**
 * Saves a note's text unless it is saved already, or empty without images (closing deletes the
 * note then).
 */
function persist(actions: NoteActions, note: Note, saved: { current: string }, text: string) {
    if (text === saved.current || (text.trim() === '' && note.images.length === 0)) return;
    saved.current = text;
    void actions.setText(note.id, text);
}

/**
 * A note's text being edited: saved as typing pauses and on close, which an empty text deletes;
 * its files and addresses tinted, a file suggested after `@` (`useReferenceField`).
 */
function NoteEditor({
    book,
    note,
    actions,
    onClose,
}: {
    book: string;
    note: Note;
    actions: NoteActions;
    onClose: () => void;
}) {
    const [text, setText] = useState(note.text);
    const settings = useNotesSettings();
    const { t } = useTranslation();
    // long lines wrap or not as the setting says (`⌥Z` switches it), the height following
    useLayoutEffect(() => fitLines(field.current, settings.lines), [settings.lines]);
    const field = useRef<HTMLTextAreaElement>(null);
    const timer = useRef<number | undefined>(undefined);
    // what is saved, and the latest text, for the unmount to save what typing left
    const saved = useRef(note.text);
    const latest = useRef(note.text);

    const save = () => {
        window.clearTimeout(timer.current);
        persist(actions, note, saved, latest.current);
    };
    const close = () => {
        window.clearTimeout(timer.current);
        // emptied, it goes, unless images are left; the toast brings it back with the text last
        // saved
        if (latest.current.trim() === '' && note.images.length === 0) void actions.remove(note);
        else save();
        onClose();
    };
    const change = (value: string) => {
        setText(value);
        latest.current = value;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(save, SAVE_DELAY_MS);
    };
    const references = useReferenceField({ book, field, text, onText: change });
    // a card scrolled out of the list unmounts: what was typed is kept
    const current = useRef(note);
    current.current = note;
    useEffect(
        () => () => {
            window.clearTimeout(timer.current);
            persist(actions, current.current, saved, latest.current);
        },
        [actions],
    );

    useEffect(() => {
        const element = field.current;
        if (!element) return;
        autosize(element);
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
    }, []);

    return (
        <>
            <textarea
                ref={field}
                value={text}
                spellCheck={false}
                aria-label={t('notes.text')}
                className={`block max-h-[60vh] w-full min-w-0 resize-none overflow-auto bg-transparent text-[13px]/[1.5] text-ui-text outline-none ${linesClass(settings.lines)}`}
                {...references.field}
                onChange={(event) => {
                    change(event.target.value);
                    autosize(event.target);
                }}
                // `Esc` blurs a field (the workspace's keys), a click outside too
                // the window losing the focus (⌘Tab to the agent's terminal) leaves the card open:
                // the focus comes back to it
                onBlur={() => {
                    references.field.onBlur();
                    if (document.hasFocus()) close();
                }}
                onKeyDown={(event) => {
                    if (references.keyDown(event)) return;
                    if (onNoteFieldKey(event, settings)) return;
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        event.currentTarget.blur();
                    }
                }}
            />
            {references.layer}
        </>
    );
}
