import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { openNotes, positionAt, withNotes, withoutNote } from '../model/notes';
import type { Note, ProjectNotes } from '../model/notes.types';
import { useNotesPort } from './notes.port';

const notesKey = (root: string) => ['notes', root] as const;

/**
 * A project's notes, read once: only the app writes them, and every change goes through the
 * cache too.
 */
export function useProjectNotes(root: string) {
    const port = useNotesPort();
    return useQuery({
        queryKey: notesKey(root),
        queryFn: () => port.getNotes(root),
        staleTime: Number.POSITIVE_INFINITY,
    });
}

/**
 * Every change to a project's notes. Each shows at once in the cache, then goes to the backend,
 * whose answer replaces it; a failure tells why and reads the notes again. What can be undone
 * says so in a toast with Undo.
 */
export function useNoteActions(root: string) {
    const port = useNotesPort();
    const client = useQueryClient();
    const showToast = useShowToast();

    return useMemo(() => {
        const key = notesKey(root);
        const current = () => client.getQueryData<ProjectNotes>(key);
        const update = (change: (notes: ProjectNotes) => ProjectNotes) =>
            client.setQueryData<ProjectNotes>(key, (notes) => (notes ? change(notes) : notes));
        /** Runs a call to the backend; a failure tells what failed and reads the notes again. */
        const run = async <T>(what: string, call: Promise<T>): Promise<T | undefined> => {
            try {
                return await call;
            } catch (error) {
                showToast(errorToast(what, error));
                void client.invalidateQueries({ queryKey: key });
                return undefined;
            }
        };
        const merge = (changed: Note[] | undefined) => {
            if (changed) update((notes) => withNotes(notes, changed));
        };
        const restore = async (note: Note) => {
            update((notes) => withNotes(notes, [note]));
            merge(
                await run('Could not undo', port.restoreNote(root, note)).then((n) =>
                    n ? [n] : undefined,
                ),
            );
        };

        return {
            /** A note on top of a list; the note as stored. */
            add: async (list: string, text: string) => {
                const note = await run('Could not add the note', port.addNote(root, list, text));
                if (note) merge([note]);
                return note;
            },
            setText: async (id: string, text: string) => {
                update((notes) =>
                    withNotes(
                        notes,
                        notes.notes.filter((n) => n.id === id).map((n) => ({ ...n, text })),
                    ),
                );
                const note = await run('Could not save the note', port.setNoteText(root, id, text));
                if (note) merge([note]);
            },
            setDone: async (note: Note, done: boolean) => {
                update((notes) => withNotes(notes, [{ ...note, done: done ? Date.now() : null }]));
                const changed = await run(
                    'Could not change the note',
                    port.setNoteDone(root, note.id, done),
                );
                if (!changed) return;
                merge([changed]);
                if (done) {
                    showToast({
                        title: 'Done',
                        action: { label: 'Undo', run: () => void restore(note) },
                    });
                }
            },
            /** Moves a note to `index` among the open notes of `list`. */
            place: async (note: Note, list: string, index: number) => {
                const notes = current();
                if (notes) {
                    const position = positionAt(openNotes(notes.notes, list), note.id, index);
                    update((all) => withNotes(all, [{ ...note, list, position }]));
                }
                merge(
                    await run(
                        'Could not move the note',
                        port.placeNote(root, note.id, list, index),
                    ),
                );
            },
            /** Moves a note on top of another list; the toast can bring it back. */
            moveTo: async (note: Note, list: { id: string; name: string }) => {
                const notes = current();
                if (notes) {
                    const position = positionAt(openNotes(notes.notes, list.id), note.id, 0);
                    update((all) => withNotes(all, [{ ...note, list: list.id, position }]));
                }
                const changed = await run(
                    'Could not move the note',
                    port.placeNote(root, note.id, list.id, 0),
                );
                if (!changed) return;
                merge(changed);
                showToast({
                    title: `Moved to ${list.name}`,
                    action: { label: 'Undo', run: () => void restore(note) },
                });
            },
            remove: async (note: Note, { undoable = true } = {}) => {
                update((notes) => withoutNote(notes, note.id));
                const removed = await run(
                    'Could not delete the note',
                    port.deleteNote(root, note.id).then(() => true),
                );
                if (removed && undoable) {
                    showToast({
                        title: 'Note deleted',
                        action: { label: 'Undo', run: () => void restore(note) },
                    });
                }
            },
            addList: async (name: string) => {
                const list = await run('Could not add the list', port.addList(root, name));
                if (list) {
                    update((notes) => ({
                        ...notes,
                        lists: [...notes.lists, list],
                        openList: list.id,
                    }));
                }
                return list;
            },
            renameList: async (id: string, name: string) => {
                update((notes) => ({
                    ...notes,
                    lists: notes.lists.map((l) => (l.id === id ? { ...l, name } : l)),
                }));
                const list = await run(
                    'Could not rename the list',
                    port.renameList(root, id, name),
                );
                if (list) {
                    update((notes) => ({
                        ...notes,
                        lists: notes.lists.map((l) => (l.id === id ? list : l)),
                    }));
                }
            },
            /** Deletes a list with its notes; the toast brings them all back. */
            deleteList: async (id: string) => {
                const before = current();
                if (!before || before.lists.length < 2) return;
                const rest = before.lists.filter((l) => l.id !== id);
                update((notes) => ({
                    lists: rest,
                    notes: notes.notes.filter((n) => n.list !== id),
                    openList: notes.openList === id ? rest[0].id : notes.openList,
                }));
                const deleted = await run('Could not delete the list', port.deleteList(root, id));
                if (!deleted) return;
                const count = deleted.notes.length;
                showToast({
                    title: `“${deleted.list.name}” deleted`,
                    description: count ? `${count} ${count === 1 ? 'note' : 'notes'} with it` : '',
                    action: {
                        label: 'Undo',
                        run: async () => {
                            const restored = await run(
                                'Could not undo',
                                port.restoreList(root, deleted),
                            );
                            if (restored) client.setQueryData(key, restored);
                        },
                    },
                });
            },
            openList: (id: string) => {
                update((notes) => ({ ...notes, openList: id }));
                void run('Could not open the list', port.openList(root, id));
            },
        };
    }, [root, port, client, showToast]);
}

export type NoteActions = ReturnType<typeof useNoteActions>;
