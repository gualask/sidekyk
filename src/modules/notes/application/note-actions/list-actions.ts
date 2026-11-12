import type { Move } from '../../model/destination';
import type { NoteList } from '../../model/notes.types';
import { notesKey } from '../notes.queries';
import type { BookChanges } from './book-changes';

/** The changes to a book's lists: each with its notes, as `useNoteActions` makes them. */
export function listActions(changes: BookChanges) {
    const { book, port, client, current, update, reread, forget, send, showToast, i18n } = changes;
    const { t } = i18n;

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

    return {
        /** Moves a list with its notes to another project; Undo brings it back as it was. */
        moveList: async (id: string, { to, name }: Move) => {
            if (!dropList(id)) return;
            const moved = await send(t('notes.moveListFailed'), () => port.moveList(book, id, to));
            if (!moved) return;
            forget(moved.to);
            showToast({
                title: t('notes.moved', { name }),
                action: {
                    label: t('notes.undo'),
                    // its notes come back as stored: read again
                    run: () =>
                        void send(t('notes.undoFailed'), () => port.unmoveList(moved), reread).then(
                            () => forget(moved.to),
                        ),
                },
            });
        },
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
            await send(t('notes.renameListFailed'), () => port.renameList(book, id, name), rename);
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
                            (restored) => client.setQueryData(notesKey(book), restored),
                        ),
                },
            });
        },
        openList: (id: string) => {
            update((notes) => ({ ...notes, openList: id }));
            void send(t('notes.openListFailed'), () => port.openList(book, id));
        },
    };
}
