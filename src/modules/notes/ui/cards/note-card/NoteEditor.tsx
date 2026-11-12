import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import { onNoteFieldKey, useNotesSettings } from '../../../application/notes-settings';
import type { Note } from '../../../model/notes.types';
import { autosize, fitLines, linesClass } from '../../notes-layout';
import { useReferenceField } from '../../references/use-reference-field';

/** How long typing pauses before the text is saved; closing the card saves at once. */
const SAVE_DELAY_MS = 500;

/**
 * A note's text being edited: saved as typing pauses and on close, which an empty text deletes;
 * its files and addresses tinted, a file suggested after `@` (`useReferenceField`).
 */
export function NoteEditor({
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
    const saving = useTextSaving(actions, note);

    const close = () => {
        saving.close();
        onClose();
    };
    const change = (value: string) => {
        setText(value);
        saving.typed(value);
    };
    const references = useReferenceField({ book, field, text, onText: change });

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

/**
 * A note's text as typed, saved once typing pauses and when the editor closes; a card scrolled out
 * of the list unmounts, and what was typed is kept.
 */
function useTextSaving(actions: NoteActions, note: Note) {
    const timer = useRef<number | undefined>(undefined);
    // what is saved, and the latest text, for the unmount to save what typing left
    const saved = useRef(note.text);
    const latest = useRef(note.text);
    const current = useRef(note);
    current.current = note;
    useEffect(
        () => () => {
            window.clearTimeout(timer.current);
            persist(actions, current.current, saved, latest.current);
        },
        [actions],
    );

    const save = () => {
        window.clearTimeout(timer.current);
        persist(actions, note, saved, latest.current);
    };
    return {
        /** The text typed: saved once typing pauses. */
        typed: (value: string) => {
            latest.current = value;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(save, SAVE_DELAY_MS);
        },
        /**
         * Saves what is typed; emptied, the note goes, unless images are left (the toast brings
         * it back with the text last saved).
         */
        close: () => {
            window.clearTimeout(timer.current);
            if (latest.current.trim() === '' && note.images.length === 0) void actions.remove(note);
            else save();
        },
    };
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
