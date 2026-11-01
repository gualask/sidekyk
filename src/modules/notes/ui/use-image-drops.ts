import { type RefObject, useEffect, useRef, useState } from 'react';
import { type ImageDrop, useNotesPort } from '../application/notes.port';
import { type NoteActions, type PendingImages, pastedImages } from '../application/notes.queries';
import type { Note } from '../model/notes.types';

/** The attribute a card is told by, holding its note's id. */
export const DROP_ATTRIBUTE = 'data-image-drop';

/** Where in a column files dragged are: over a card (its note), or over the rest, the field's. */
type DropTarget = { card: string } | 'field';

/** What a point of the page is to a column: outside it (null), a card of it, or the rest of it. */
function targetAt(root: HTMLElement | null, x: number, y: number): DropTarget | null {
    const element = document.elementFromPoint(x, y);
    if (!root || !element || !root.contains(element)) return null;
    const card = element.closest(`[${DROP_ATTRIBUTE}]`)?.getAttribute(DROP_ATTRIBUTE);
    return card ? { card } : 'field';
}

/**
 * Files dragged over a column (`root`) of `book`: the target under them, lit up while they are,
 * and on drop given to it, a card's note or `onField` (the field on top, which decides). Each
 * column follows the window's drags and takes only those over itself.
 */
function useImageDrops(
    root: RefObject<HTMLElement | null>,
    book: string,
    actions: NoteActions,
    onField: (pending: PendingImages) => void,
): DropTarget | null {
    const port = useNotesPort();
    const [over, setOver] = useState<DropTarget | null>(null);
    // the latest callbacks, without following the drags again
    const latest = useRef({ actions, onField });
    latest.current = { actions, onField };

    useEffect(
        () =>
            port.onImageDrop((drop: ImageDrop) => {
                if (drop.kind === 'leave') {
                    setOver(null);
                    return;
                }
                const target = targetAt(root.current, drop.x, drop.y);
                if (drop.kind === 'over') {
                    setOver(target);
                    return;
                }
                setOver(null);
                if (target === null) return;
                const { actions, onField } = latest.current;
                const pending: PendingImages = {
                    names: drop.names,
                    previews: [],
                    add: (to) => drop.add(book, to),
                };
                if (target === 'field') onField(pending);
                else void actions.addImages(pending, { kind: 'note', id: target.card });
            }),
        [port, book, root],
    );
    return over;
}

/**
 * What a column of cards gives its field on top and its cards for images: a note added with its
 * text and images goes on top (`onAdded`), the field takes images pasted and those dropped on
 * the column but on a card, and the card or the field under a drag is lit up.
 */
export function useColumnImages({
    root,
    book,
    actions,
    list,
    onAdded,
}: {
    root: RefObject<HTMLElement | null>;
    book: string;
    actions: NoteActions;
    /** The list a new note goes on top of. */
    list: string;
    onAdded: (note: Note) => void;
}) {
    const port = useNotesPort();
    const dropInto = useRef<((images: PendingImages) => void) | null>(null);
    const over = useImageDrops(root, book, actions, (images) => dropInto.current?.(images));
    return {
        /** The note whose card files are dragged over, if any. */
        overCard: over !== null && over !== 'field' ? over.card : null,
        composer: {
            pasted: (files: readonly File[]) => pastedImages(port, book, files),
            dropInto,
            dropping: over === 'field',
            onAdd: async (text: string, images: readonly PendingImages[]) => {
                const { note, left } = await actions.addWithImages(list, text, images);
                if (note) onAdded(note);
                return { added: note !== undefined, left };
            },
        },
    };
}
