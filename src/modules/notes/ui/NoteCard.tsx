import { Menu } from '@base-ui/react/menu';
import { IconCheck, IconDots, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { CopyIcon } from '@/shared/ui/CopyIcon';
import { type CopyState, copyLabel } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { NoteActions } from '../application/notes.queries';
import { noteMeta } from '../model/notes';
import type { Note, NoteList } from '../model/notes.types';
import { autosize } from './notes-layout';

/** How long typing pauses before the text is saved; closing the card saves at once. */
const SAVE_DELAY_MS = 500;

/**
 * One note: done on the left, copy and ⋯ on the right, the text in between, four lines until
 * clicked. Clicked, the text is edited in place: saved as typing pauses, closed by `Esc`, `⌘↵` or a
 * click outside; emptied, the note goes (with Undo).
 */
export function NoteCard({
    note,
    flash,
    lists,
    editing,
    onEdit,
    actions,
    copied,
    onCopy,
    order,
}: {
    note: Note;
    /** Lit up for a moment: brought into view from the palette. */
    flash: boolean;
    lists: readonly NoteList[];
    editing: boolean;
    onEdit: (editing: boolean) => void;
    actions: NoteActions;
    copied: CopyState;
    onCopy: () => void;
    /** For an open note among others: whether it is on top, and the reorder mode to start. */
    order: { top: boolean; moveToTop: () => void; reorder: () => void } | null;
}) {
    const done = note.done !== null;
    const others = lists.filter((list) => list.id !== note.list);

    return (
        <article
            className={`group/card relative grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 rounded-[9px] border bg-ui-surface-subtle py-2 pr-1.5 pl-2.5 ${
                editing ? 'border-ui-accent' : 'border-ui-border hover:border-ui-border-hover'
            } ${flash ? 'note-flash' : ''}`}
            aria-label="Note"
        >
            <button
                type="button"
                className={`row-span-2 mt-px grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted ${
                    done
                        ? 'border-ui-success bg-ui-success text-ui-surface'
                        : 'border-ui-text-muted text-transparent hover:border-ui-success hover:text-ui-success'
                }`}
                title={done ? 'Not done' : 'Done'}
                aria-label={done ? 'Mark as not done' : 'Mark as done'}
                onClick={() => void actions.setDone(note, !done)}
            >
                <IconCheck size={11} stroke={3} />
            </button>
            {editing ? (
                <NoteEditor note={note} actions={actions} onClose={() => onEdit(false)} />
            ) : (
                <button
                    type="button"
                    className={`line-clamp-4 min-w-0 cursor-text text-left text-[13px]/[1.5] break-words whitespace-pre-wrap focus-visible:outline-none ${
                        done ? 'text-ui-text-muted' : 'text-ui-text-secondary'
                    }`}
                    title="Click to edit"
                    onClick={() => onEdit(true)}
                >
                    {note.text}
                </button>
            )}
            <div className="col-start-2 text-[11.5px] text-ui-text-muted">
                {noteMeta(note, Date.now())}
            </div>
            <div className="col-start-3 row-span-2 row-start-1 -mt-0.5 -mr-0.5 flex items-start">
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    title={copyLabel(copied, 'Copy note')}
                    aria-label={copyLabel(copied, 'Copy note')}
                    onClick={onCopy}
                >
                    <CopyIcon copied={copied} />
                </button>
                <Menu.Root>
                    <Menu.Trigger
                        className="btn-icon h-6 w-6 data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text"
                        title="More"
                        aria-label="More for this note"
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
                                                Move to top
                                            </Menu.Item>
                                        )}
                                        <Menu.Item className="menu-item" onClick={order.reorder}>
                                            Reorder…
                                        </Menu.Item>
                                        <Menu.Separator className="mx-1.5 my-1 h-px bg-ui-border" />
                                    </>
                                ) : null}
                                {others.length > 0 ? (
                                    <>
                                        <Menu.Group>
                                            <Menu.GroupLabel className="px-3 pt-1 pb-0.5 text-[11px] tracking-[.04em] text-ui-text-muted uppercase">
                                                Move to
                                            </Menu.GroupLabel>
                                            {others.map((list) => (
                                                <Menu.Item
                                                    key={list.id}
                                                    className="menu-item"
                                                    onClick={() => void actions.moveTo(note, list)}
                                                >
                                                    <span className="truncate">{list.name}</span>
                                                </Menu.Item>
                                            ))}
                                        </Menu.Group>
                                        <Menu.Separator className="mx-1.5 my-1 h-px bg-ui-border" />
                                    </>
                                ) : null}
                                <Menu.Item
                                    className="menu-item danger"
                                    onClick={() => void actions.remove(note)}
                                >
                                    <IconTrash size={14} />
                                    Delete
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            </div>
        </article>
    );
}

/** Saves a note's text unless it is saved already, or empty (closing deletes it then). */
function persist(actions: NoteActions, id: string, saved: { current: string }, text: string) {
    if (text === saved.current || text.trim() === '') return;
    saved.current = text;
    void actions.setText(id, text);
}

/** A note's text being edited: saved as typing pauses and on close, which an empty text deletes. */
function NoteEditor({
    note,
    actions,
    onClose,
}: {
    note: Note;
    actions: NoteActions;
    onClose: () => void;
}) {
    const [text, setText] = useState(note.text);
    const field = useRef<HTMLTextAreaElement>(null);
    const timer = useRef<number | undefined>(undefined);
    // what is saved, and the latest text, for the unmount to save what typing left
    const saved = useRef(note.text);
    const latest = useRef(note.text);

    const save = () => {
        window.clearTimeout(timer.current);
        persist(actions, note.id, saved, latest.current);
    };
    const close = () => {
        window.clearTimeout(timer.current);
        // emptied, it goes; the toast brings it back with the text last saved
        if (latest.current.trim() === '') void actions.remove(note);
        else save();
        onClose();
    };
    // a card scrolled out of the list unmounts: what was typed is kept
    useEffect(
        () => () => {
            window.clearTimeout(timer.current);
            persist(actions, note.id, saved, latest.current);
        },
        [actions, note.id],
    );

    useEffect(() => {
        const element = field.current;
        if (!element) return;
        autosize(element);
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
    }, []);

    return (
        <textarea
            ref={field}
            value={text}
            spellCheck={false}
            aria-label="Note text"
            className="block max-h-[60vh] w-full min-w-0 resize-none overflow-auto bg-transparent text-[13px]/[1.5] text-ui-text break-words whitespace-pre-wrap outline-none"
            onChange={(event) => {
                setText(event.target.value);
                latest.current = event.target.value;
                autosize(event.target);
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(save, SAVE_DELAY_MS);
            }}
            // `Esc` blurs a field (the workspace's keys), a click outside too
            // the window losing the focus (⌘Tab to the agent's terminal) leaves the card open:
            // the focus comes back to it
            onBlur={() => {
                if (document.hasFocus()) close();
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
            }}
        />
    );
}
