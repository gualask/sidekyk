import type { QueryClient } from '@tanstack/react-query';
import type { Translator } from '@/shared/i18n';
import { errorToast, type ToastRequest } from '@/shared/ui/toasts';
import type { ProjectNotes } from '../../model/notes.types';
import { changeQueue } from '../change-queue';
import type { NotesPort } from '../notes.port';
import { notesKey, openKey } from '../notes.queries';

/**
 * A book's notes as its actions change them (`useNoteActions`): on screen at once in the cache,
 * then sent to the backend in turn.
 */
export interface BookChanges {
    book: string;
    port: NotesPort;
    client: QueryClient;
    showToast: (toast: ToastRequest) => void;
    i18n: Translator;
    current: () => ProjectNotes | undefined;
    update: (change: (notes: ProjectNotes) => ProjectNotes) => void;
    reread: () => void;
    /** Another book changed by a move: read again when it shows, its row's count too. */
    forget: (other: string) => void;
    /** Sends a change; `shown` puts its answer on screen when nothing newer is there. */
    send: <T>(
        what: string,
        call: () => Promise<T>,
        shown?: (value: T) => void,
    ) => Promise<T | undefined>;
}

/** What a book's changes go through: its port, the cache and the toasts. */
type BookScope = Pick<BookChanges, 'book' | 'port' | 'client' | 'showToast' | 'i18n'>;

/**
 * A book's changes over its cache entry and its queue (`changeQueue`): the answer of the last one
 * is shown, and if answers were skipped behind newer changes, the notes are read again. A failure
 * tells why and reads them again too.
 */
export function bookChanges(scope: BookScope): BookChanges {
    const { book, client, showToast, i18n } = scope;
    const key = notesKey(book);
    const queue = changeQueue(book);
    const current = () => client.getQueryData<ProjectNotes>(key);
    const update = (change: (notes: ProjectNotes) => ProjectNotes) =>
        client.setQueryData<ProjectNotes>(key, (notes) => (notes ? change(notes) : notes));
    const reread = () => void client.invalidateQueries({ queryKey: key });
    const forget = (other: string) => {
        if (other !== book) void client.invalidateQueries({ queryKey: notesKey(other) });
    };
    const send = async <T>(
        what: string,
        call: () => Promise<T>,
        shown: (value: T) => void = () => undefined,
    ): Promise<T | undefined> => {
        try {
            const answer = await queue.run(call);
            if (answer.kind === 'apply') shown(answer.value);
            else if (answer.kind === 'reread') reread();
            // the row's count of open notes is read again when it shows
            void client.invalidateQueries({ queryKey: openKey(book) });
            return answer.value;
        } catch (error) {
            showToast(errorToast(what, error, i18n));
            reread();
            return undefined;
        }
    };
    return { ...scope, current, update, reread, forget, send };
}
