import { useEffect, useRef } from 'react';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import type { Note } from '../../../model/notes.types';

/** How long typing pauses before the text is saved; closing the card saves at once. */
const SAVE_DELAY_MS = 500;

/**
 * A note's text as typed, saved once typing pauses and when the editor closes; a card scrolled out
 * of the list unmounts, and what was typed is kept.
 */
export function useTextSaving(actions: NoteActions, note: Note) {
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
 * note then). Marked saved at once, so typing does not send it twice; a failure takes the mark
 * back, unless a later text was sent meanwhile, so closing tries again.
 */
function persist(actions: NoteActions, note: Note, saved: { current: string }, text: string) {
    if (text === saved.current || (text.trim() === '' && note.images.length === 0)) return;
    const before = saved.current;
    saved.current = text;
    void actions.setText(note.id, text).then((stored) => {
        if (!stored && saved.current === text) saved.current = before;
    });
}
