import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { openNotes, positionAt, withNotes, withoutNote, withUpdated } from '../model/notes';
import type { Note, NoteList, ProjectNotes } from '../model/notes.types';
import { changeQueue } from './change-queue';
import { useNotesPort } from './notes.port';

/**
 * Where a project's notes are cached, and below the same key what is told of them (its card's
 * summary, the count before a removal): one family, so reading a project's notes again, or
 * forgetting them, takes all of it.
 */
export const notesKey = (root: string) => ['notes', root] as const;
const summaryKey = (root: string) => [...notesKey(root), 'summary'] as const;
const countKey = (root: string) => [...notesKey(root), 'count'] as const;

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
 * Every change to a project's notes. Each shows at once in the cache, then goes to the backend
 * after the changes made before it (`changeQueue`); the answer of the last one is shown, and if
 * answers were skipped behind newer changes, the notes are read again. A failure tells why and
 * reads them again too. What can be undone says so in a toast with Undo, which undoes only that.
 */
export function useNoteActions(root: string) {
    const port = useNotesPort();
    const client = useQueryClient();
    const showToast = useShowToast();

    return useMemo(() => {
        const key = notesKey(root);
        const queue = changeQueue(root);
        const current = () => client.getQueryData<ProjectNotes>(key);
        const update = (change: (notes: ProjectNotes) => ProjectNotes) =>
            client.setQueryData<ProjectNotes>(key, (notes) => (notes ? change(notes) : notes));
        const reread = () => void client.invalidateQueries({ queryKey: key });
        /** A note as on screen, with some of its fields changed. */
        const patch = (id: string, fields: Partial<Note>) =>
            update((notes) => ({
                ...notes,
                notes: notes.notes.map((note) => (note.id === id ? { ...note, ...fields } : note)),
            }));
        const updated = (notes: Note[]) => update((all) => withUpdated(all, notes));

        /** Sends a change; `shown` puts its answer on screen when nothing newer is there. */
        const send = async <T>(
            what: string,
            call: () => Promise<T>,
            shown: (value: T) => void = () => undefined,
        ): Promise<T | undefined> => {
            try {
                const answer = await queue.run(call);
                if (answer.kind === 'apply') shown(answer.value);
                else if (answer.kind === 'reread') reread();
                // the card's summary is read again when it shows
                void client.invalidateQueries({ queryKey: summaryKey(root) });
                return answer.value;
            } catch (error) {
                showToast(errorToast(what, error));
                reread();
                return undefined;
            }
        };

        /** Moves a note to `index` among the open notes of `list`. */
        const place = async (note: Note, list: string, index: number) => {
            const notes = current();
            if (notes) {
                const position = positionAt(openNotes(notes.notes, list), note.id, index);
                patch(note.id, { list, position });
            }
            return send(
                'Could not move the note',
                () => port.placeNote(root, note.id, list, index),
                updated,
            );
        };
        const setDone = async (note: Note, done: boolean) => {
            patch(note.id, { done: done ? Date.now() : null });
            return send(
                'Could not change the note',
                () => port.setNoteDone(root, note.id, done),
                (changed) => updated([changed]),
            );
        };
        /** Puts a note back as it was given, deleted or not. */
        const restore = async (note: Note) => {
            update((notes) => withNotes(notes, [note]));
            await send(
                'Could not undo',
                () => port.restoreNote(root, note),
                (restored) => update((notes) => withNotes(notes, [restored])),
            );
        };
        /** Deletes a note; `undoable`, the toast brings it back as it was. */
        const remove = async (note: Note, { undoable = true } = {}) => {
            update((notes) => withoutNote(notes, note.id));
            const removed = await send('Could not delete the note', () =>
                port.deleteNote(root, note.id).then(() => true),
            );
            if (removed && undoable) {
                showToast({
                    title: 'Note deleted',
                    action: { label: 'Undo', run: () => void restore(note) },
                });
            }
        };

        return {
            /** A note on top of a list; the note as stored, or undefined when it failed. */
            add: (list: string, text: string) =>
                send(
                    'Could not add the note',
                    () => port.addNote(root, list, text),
                    (note) => update((notes) => withNotes(notes, [note])),
                ),
            setText: async (id: string, text: string) => {
                patch(id, { text });
                await send(
                    'Could not save the note',
                    () => port.setNoteText(root, id, text),
                    (note) => updated([note]),
                );
            },
            /** Done, with Undo; or open again. */
            setDone: async (note: Note, done: boolean) => {
                const changed = await setDone(note, done);
                if (changed && done) {
                    showToast({
                        title: 'Done',
                        action: { label: 'Undo', run: () => void setDone(changed, false) },
                    });
                }
            },
            place: (note: Note, list: string, index: number) => void place(note, list, index),
            /** Moves a note on top of another list; Undo takes it back where it was. */
            moveTo: async (note: Note, list: NoteList) => {
                const from = openNotes(current()?.notes ?? [], note.list).findIndex(
                    (open) => open.id === note.id,
                );
                const moved = await place(note, list.id, 0);
                if (!moved) return;
                showToast({
                    title: `Moved to ${list.name}`,
                    action: {
                        label: 'Undo',
                        run: () => void place(note, note.list, Math.max(0, from)),
                    },
                });
            },
            remove,
            addList: async (name: string) =>
                send(
                    'Could not add the list',
                    () => port.addList(root, name),
                    (list) =>
                        update((notes) => ({
                            ...notes,
                            lists: [...notes.lists, list],
                            openList: list.id,
                        })),
                ),
            renameList: async (id: string, name: string) => {
                const rename = (list: NoteList) =>
                    update((notes) => ({
                        ...notes,
                        lists: notes.lists.map((l) => (l.id === id ? list : l)),
                    }));
                rename({ id, name });
                await send(
                    'Could not rename the list',
                    () => port.renameList(root, id, name),
                    rename,
                );
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
                const deleted = await send('Could not delete the list', () =>
                    port.deleteList(root, id),
                );
                if (!deleted) return;
                const count = deleted.notes.length;
                showToast({
                    title: `“${deleted.list.name}” deleted`,
                    description: count ? `${count} ${count === 1 ? 'note' : 'notes'} with it` : '',
                    action: {
                        label: 'Undo',
                        run: () =>
                            void send(
                                'Could not undo',
                                () => port.restoreList(root, deleted),
                                (restored) => client.setQueryData(key, restored),
                            ),
                    },
                });
            },
            openList: (id: string) => {
                update((notes) => ({ ...notes, openList: id }));
                void send('Could not open the list', () => port.openList(root, id));
            },
        };
    }, [root, port, client, showToast]);
}

export type NoteActions = ReturnType<typeof useNoteActions>;

/**
 * Saves a project's notes as Markdown where the user picks, and says where; the path, or null
 * when cancelled or failed (a toast says why).
 */
export function useExportNotes(root: string) {
    const port = useNotesPort();
    const showToast = useShowToast();
    return useCallback(async () => {
        try {
            const path = await port.exportNotes(root);
            if (path) showToast({ title: 'Notes exported', description: path });
            return path;
        } catch (error) {
            showToast(errorToast('Could not export the notes', error));
            return null;
        }
    }, [root, port, showToast]);
}

/** How many notes a project has, counted each time it is asked: notes just written count. */
export function useNotesCount(root: string) {
    const port = useNotesPort();
    return useQuery({
        queryKey: countKey(root),
        queryFn: () => port.countNotes(root),
        gcTime: 0,
        staleTime: 0,
    });
}

/**
 * Reads every project's notes again, those on screen now, the others when they show: for a
 * change made outside Notes, such as a project's notes joining another's.
 */
export function useRereadNotes() {
    const client = useQueryClient();
    return useCallback(() => void client.invalidateQueries({ queryKey: ['notes'] }), [client]);
}

/**
 * What a project's card tells of its notes, read each time all projects shows (the backend keeps
 * it in memory once read).
 */
export function useNotesSummary(root: string) {
    const port = useNotesPort();
    return useQuery({
        queryKey: summaryKey(root),
        queryFn: () => port.notesSummary(root),
        staleTime: 0,
    });
}
