import {
    type ClipboardEvent,
    type KeyboardEvent,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from 'react';
import type { PendingImages } from '../application/notes.queries';
import { onNoteFieldKey, useNotesSettings } from '../application/notes-settings';

/** Frees what pending images hold for their previews. */
function release(pending: readonly PendingImages[]) {
    for (const images of pending) {
        for (const url of images.previews) URL.revokeObjectURL(url);
    }
}

/**
 * A note being written in a field that makes notes (on top of notes, the quick note): `↵` adds it,
 * `⇧↵` breaks the line, a paste into the empty field adds it at once. Images pasted or dropped
 * into the empty field add a note of them at once; with text there, they wait for `↵`. The field
 * keeps the text until a note is made of it, and the images until they are added: a failure
 * loses nothing (images that failed wait, to try again or leave out); what was typed meanwhile
 * stays.
 */
export function useNoteDraft({
    field,
    onAdd,
    pasted,
    dropInto,
    onCleared,
}: {
    field: RefObject<HTMLTextAreaElement | null>;
    /**
     * Adds the note, its text then its images: whether a note was made, and the images left out
     * by a step that failed.
     */
    onAdd: (
        text: string,
        images: readonly PendingImages[],
    ) => Promise<{ added: boolean; left: PendingImages[] }>;
    /** Files pasted, as images to add. */
    pasted: (files: readonly File[]) => PendingImages;
    /** Where the column hands the images dropped on it, but on a card. */
    dropInto: RefObject<((images: PendingImages) => void) | null>;
    /** The field emptied once its note was made, to fit its height. */
    onCleared?: (field: HTMLTextAreaElement) => void;
}) {
    const settings = useNotesSettings();
    const [text, setText] = useState('');
    const [pending, setPending] = useState<PendingImages[]>([]);
    // the previews still waiting go with the field
    const waiting = useRef(pending);
    waiting.current = pending;
    useEffect(() => () => release(waiting.current), []);
    // one note at a time: a second ↵ while the first is being added adds nothing
    const adding = useRef(false);

    const add = async (value: string, images: readonly PendingImages[]) => {
        const note = value.trimEnd();
        if ((note.trim() === '' && images.length === 0) || adding.current) return;
        adding.current = true;
        const { added, left } = await onAdd(note, images);
        adding.current = false;
        release(images.filter((p) => !left.includes(p)));
        setPending((all) => [...all.filter((p) => !images.includes(p)), ...left]);
        const typed = field.current;
        if (!added || !typed || typed.value !== value) return;
        setText('');
        typed.value = '';
        onCleared?.(typed);
    };
    // images into the empty field make a note at once; with text, they wait for ↵
    const take = (images: PendingImages) => {
        const typed = field.current?.value ?? '';
        if (typed.trim() === '' && waiting.current.length === 0) void add('', [images]);
        else setPending((all) => [...all, images]);
    };
    dropInto.current = take;

    return {
        pending,
        /** Leaves images waiting out of the note. */
        dropPending: (images: PendingImages) => {
            release([images]);
            setPending((all) => all.filter((p) => p !== images));
        },
        /** What the field takes: its text and its keys. */
        field: {
            value: text,
            onChange: (event: { target: HTMLTextAreaElement }) => setText(event.target.value),
            onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (onNoteFieldKey(event, settings)) return;
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
                    return;
                }
                event.preventDefault();
                void add(text, pending);
            },
            onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
                // files copied (a screenshot, a file in the file manager): the backend refuses
                // those that are not images a note takes
                const files = [...event.clipboardData.files];
                if (files.length > 0) {
                    event.preventDefault();
                    take(pasted(files));
                    return;
                }
                if (text !== '' || pending.length > 0) return;
                const typed = event.clipboardData.getData('text/plain');
                if (typed.trim() === '') return;
                event.preventDefault();
                void add(typed, []);
            },
        },
    };
}
