import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import { useShowToast } from '@/shared/ui/toasts';
import type { Move } from '../../model/destination';
import { openNotes, positionAt, withNotes, withoutNote, withUpdated } from '../../model/notes';
import type { ImageTarget, Mark, Note, NoteImage } from '../../model/notes.types';
import { useNotesPort } from '../notes.port';
import type { PendingImages } from '../pending-images';
import { bookChanges } from './book-changes';
import { listActions } from './list-actions';

/**
 * Every change to a book's notes. Each shows at once in the cache, then goes to the backend
 * after the changes made before it (`bookChanges`). What can be undone says so in a toast with
 * Undo, which undoes only that.
 */
export function useNoteActions(book: string) {
    const port = useNotesPort();
    const client = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();

    return useMemo(() => {
        const { t } = i18n;
        const changes = bookChanges({ book, port, client, showToast, i18n });
        const { current, update, forget, send } = changes;
        /** A note as on screen, with some of its fields changed. */
        const patch = (id: string, fields: Partial<Note>) =>
            update((notes) => ({
                ...notes,
                notes: notes.notes.map((note) => (note.id === id ? { ...note, ...fields } : note)),
            }));
        const updated = (notes: Note[]) => update((all) => withUpdated(all, notes));

        /** Moves a note to `index` among the open notes of `list`. */
        const place = async (note: Note, list: string, index: number) => {
            const notes = current();
            if (notes) {
                const position = positionAt(openNotes(notes.notes, list), note.id, index);
                patch(note.id, { list, position });
            }
            return send(
                t('notes.moveFailed'),
                () => port.placeNote(book, note.id, list, index),
                updated,
            );
        };
        const setDone = async (note: Note, done: boolean) => {
            patch(note.id, { done: done ? Date.now() : null });
            return send(
                t('notes.changeFailed'),
                () => port.setNoteDone(book, note.id, done),
                (changed) => updated([changed]),
            );
        };
        /** Puts a note back as it was given, deleted or not. */
        const restore = async (note: Note) => {
            update((notes) => withNotes(notes, [note]));
            await send(
                t('notes.undoFailed'),
                () => port.restoreNote(book, note),
                (restored) => update((notes) => withNotes(notes, [restored])),
            );
        };
        /** Deletes a note; `undoable`, the toast brings it back as it was. */
        const remove = async (note: Note, { undoable = true } = {}) => {
            update((notes) => withoutNote(notes, note.id));
            const removed = await send(t('notes.deleteFailed'), () =>
                port.deleteNote(book, note.id).then(() => true),
            );
            if (removed && undoable) {
                showToast({
                    title: t('notes.deleted'),
                    action: { label: t('notes.undo'), run: () => void restore(note) },
                });
            }
        };

        /** Adds images to a note, or to a new one; the note as stored, or undefined. */
        const addImages = (pending: PendingImages, target: ImageTarget) =>
            send(
                t('notes.addImageFailed'),
                () => pending.add(target),
                (note) => update((notes) => withNotes(notes, [note])),
            );

        return {
            /**
             * A note on top of a list with its text and the images waiting for it, in order. The
             * note as stored, if any was made, and the images left out by a step that failed (a
             * toast says why): the field keeps those, never the text of a note made.
             */
            addWithImages: async (
                list: string,
                text: string,
                pending: readonly PendingImages[],
            ): Promise<{ note: Note | undefined; left: PendingImages[] }> => {
                let note: Note | undefined;
                if (text.trim() !== '') {
                    note = await send(
                        t('notes.addFailed'),
                        () => port.addNote(book, list, text),
                        (added) => update((notes) => withNotes(notes, [added])),
                    );
                    if (!note) return { note, left: [...pending] };
                }
                for (const [index, images] of pending.entries()) {
                    const target: ImageTarget = note
                        ? { kind: 'note', id: note.id }
                        : { kind: 'new', list };
                    const added = await addImages(images, target);
                    if (!added) return { note, left: pending.slice(index) };
                    note = added;
                }
                return { note, left: [] };
            },
            addImages,
            /**
             * Marks a note's image anew: `draw` gives the PNG of the marks over the image as
             * given (none without marks). The note as stored, or undefined when it failed.
             */
            markImage: (
                note: Note,
                image: NoteImage,
                marks: Mark[],
                draw: () => Promise<Uint8Array<ArrayBuffer> | null>,
            ) =>
                send(
                    t('notes.markImageFailed'),
                    async () => port.markImage(book, note.id, image.id, marks, await draw()),
                    (marked) => updated([marked]),
                ),
            /** Takes an image out of a note; the toast puts it back. */
            removeImage: async (note: Note, image: NoteImage) => {
                patch(note.id, { images: note.images.filter((i) => i.id !== image.id) });
                const changed = await send(
                    t('notes.removeImageFailed'),
                    () => port.removeImage(book, note.id, image.id),
                    (removed) => updated([removed]),
                );
                if (!changed) return;
                showToast({
                    title: t('notes.imageRemoved'),
                    action: { label: t('notes.undo'), run: () => void restore(note) },
                });
            },
            /** A note on top of a list; the note as stored, or undefined when it failed. */
            add: (list: string, text: string) =>
                send(
                    t('notes.addFailed'),
                    () => port.addNote(book, list, text),
                    (note) => update((notes) => withNotes(notes, [note])),
                ),
            setText: async (id: string, text: string) => {
                patch(id, { text });
                await send(
                    t('notes.saveFailed'),
                    () => port.setNoteText(book, id, text),
                    (note) => updated([note]),
                );
            },
            /** Done, with Undo; or open again. */
            setDone: async (note: Note, done: boolean) => {
                const changed = await setDone(note, done);
                if (changed && done) {
                    showToast({
                        title: t('notes.done'),
                        action: { label: t('notes.undo'), run: () => void setDone(changed, false) },
                    });
                }
            },
            place: (note: Note, list: string, index: number) => void place(note, list, index),
            /**
             * Moves a note to another book or list (the Move dialog); Undo puts it back in its
             * book, list and place. The book it went to is read again when it shows. `added`: a
             * note just written into the Inbox for there (the quick note), as the toast says.
             */
            moveNote: async (note: Note, { to, list, name }: Move, { added = false } = {}) => {
                update((notes) => withoutNote(notes, note.id));
                const moved = await send(t('notes.moveFailed'), () =>
                    port.moveNote(book, note.id, to, list),
                );
                if (!moved) return;
                if (moved.to === book) update((notes) => withNotes(notes, [moved.note]));
                forget(moved.to);
                showToast({
                    title: added ? t('notes.addedTo', { name }) : t('notes.moved', { name }),
                    action: {
                        label: t('notes.undo'),
                        run: () => {
                            update((notes) => withNotes(notes, [note]));
                            void send(
                                t('notes.undoFailed'),
                                () => port.unmoveNote(moved.to, note, book),
                                (restored) => update((notes) => withNotes(notes, [restored])),
                            ).then(() => forget(moved.to));
                        },
                    },
                });
            },
            remove,
            ...listActions(changes),
        };
    }, [book, port, client, showToast, i18n]);
}

export type NoteActions = ReturnType<typeof useNoteActions>;
