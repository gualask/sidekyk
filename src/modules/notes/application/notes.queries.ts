import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import type { Move } from '../model/move-dialog';
import { openNotes, positionAt, withNotes, withoutNote, withUpdated } from '../model/notes';
import type { Note, NoteList, ProjectNotes } from '../model/notes.types';
import { changeQueue } from './change-queue';
import { useNotesPort } from './notes.port';

/**
 * Where a book's notes are cached, and below the same key what is told of them (a project card's
 * summary, the count before a removal): one family, so reading a book's notes again, or
 * forgetting them, takes all of it.
 */
export const notesKey = (book: string) => ['notes', book] as const;
const summaryKey = (book: string) => [...notesKey(book), 'summary'] as const;
const countKey = (book: string) => [...notesKey(book), 'count'] as const;

/**
 * A book's notes, read once: only the app writes them, and every change goes through the cache
 * too.
 */
export function useNotes(book: string, enabled = true) {
    const port = useNotesPort();
    return useQuery({
        queryKey: notesKey(book),
        queryFn: () => port.getNotes(book),
        staleTime: Number.POSITIVE_INFINITY,
        enabled,
    });
}

/**
 * Every change to a book's notes. Each shows at once in the cache, then goes to the backend
 * after the changes made before it (`changeQueue`); the answer of the last one is shown, and if
 * answers were skipped behind newer changes, the notes are read again. A failure tells why and
 * reads them again too. What can be undone says so in a toast with Undo, which undoes only that.
 */
export function useNoteActions(book: string) {
    const port = useNotesPort();
    const client = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();

    return useMemo(() => {
        const { t } = i18n;
        const key = notesKey(book);
        const queue = changeQueue(book);
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
        /** Another book changed by a move: read again when it shows, its summary too. */
        const forget = (other: string) => {
            if (other !== book) void client.invalidateQueries({ queryKey: notesKey(other) });
        };
        /** Takes a list and its notes off the screen, unless it is the last; whether it did. */
        const dropList = (id: string) => {
            const before = current();
            if (!before || before.lists.length < 2) return false;
            const rest = before.lists.filter((l) => l.id !== id);
            update((notes) => ({
                lists: rest,
                notes: notes.notes.filter((n) => n.list !== id),
                openList: notes.openList === id ? rest[0].id : notes.openList,
            }));
            return true;
        };

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
                void client.invalidateQueries({ queryKey: summaryKey(book) });
                return answer.value;
            } catch (error) {
                showToast(errorToast(what, error, i18n));
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

        return {
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
             * book, list and place. The book it went to is read again when it shows.
             */
            moveNote: async (note: Note, { to, list, name }: Move) => {
                update((notes) => withoutNote(notes, note.id));
                const moved = await send(t('notes.moveFailed'), () =>
                    port.moveNote(book, note.id, to, list),
                );
                if (!moved) return;
                if (moved.to === book) update((notes) => withNotes(notes, [moved.note]));
                forget(moved.to);
                showToast({
                    title: t('notes.moved', { name }),
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
            /** Moves a list with its notes to another project; Undo brings it back as it was. */
            moveList: async (id: string, { to, name }: Move) => {
                if (!dropList(id)) return;
                const moved = await send(t('notes.moveListFailed'), () =>
                    port.moveList(book, id, to),
                );
                if (!moved) return;
                forget(moved.to);
                showToast({
                    title: t('notes.moved', { name }),
                    action: {
                        label: t('notes.undo'),
                        // its notes come back as stored: read again
                        run: () =>
                            void send(
                                t('notes.undoFailed'),
                                () => port.unmoveList(moved),
                                reread,
                            ).then(() => forget(moved.to)),
                    },
                });
            },
            remove,
            addList: async (name: string) =>
                send(
                    t('notes.addListFailed'),
                    () => port.addList(book, name),
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
                    t('notes.renameListFailed'),
                    () => port.renameList(book, id, name),
                    rename,
                );
            },
            /** Deletes a list with its notes; the toast brings them all back. */
            deleteList: async (id: string) => {
                if (!dropList(id)) return;
                const deleted = await send(t('notes.deleteListFailed'), () =>
                    port.deleteList(book, id),
                );
                if (!deleted) return;
                const count = deleted.notes.length;
                showToast({
                    title: t('notes.listDeleted', { list: deleted.list.name }),
                    description: count ? i18n.tp('notes.listDeletedNotes', count) : '',
                    action: {
                        label: t('notes.undo'),
                        run: () =>
                            void send(
                                t('notes.undoFailed'),
                                () => port.restoreList(book, deleted),
                                (restored) => client.setQueryData(key, restored),
                            ),
                    },
                });
            },
            openList: (id: string) => {
                update((notes) => ({ ...notes, openList: id }));
                void send(t('notes.openListFailed'), () => port.openList(book, id));
            },
        };
    }, [book, port, client, showToast, i18n]);
}

export type NoteActions = ReturnType<typeof useNoteActions>;

/**
 * Saves a project's notes as Markdown where the user picks, and says where; the path, or null
 * when cancelled or failed (a toast says why).
 */
export function useExportNotes(projectId: string) {
    const port = useNotesPort();
    const showToast = useShowToast();
    const i18n = useTranslation();
    return useCallback(async () => {
        try {
            const path = await port.exportNotes(projectId);
            if (path) showToast({ title: i18n.t('notes.exported'), description: path });
            return path;
        } catch (error) {
            showToast(errorToast(i18n.t('notes.exportFailed'), error, i18n));
            return null;
        }
    }, [projectId, port, showToast, i18n]);
}

/** How many notes a book has, counted each time it is asked: notes just written count. */
export function useNotesCount(book: string) {
    const port = useNotesPort();
    return useQuery({
        queryKey: countKey(book),
        queryFn: () => port.countNotes(book),
        gcTime: 0,
        staleTime: 0,
    });
}

/**
 * What a book tells of its notes (a project's card), read each time all projects shows (the
 * backend keeps it in memory once read).
 */
export function useNotesSummary(book: string) {
    const port = useNotesPort();
    return useQuery({
        queryKey: summaryKey(book),
        queryFn: () => port.notesSummary(book),
        staleTime: 0,
    });
}
