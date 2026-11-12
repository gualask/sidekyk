import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { useNotesPort } from './notes.port';

/**
 * Where a book's notes are cached, and below the same key what is told of them (the open ones on
 * its row, the count before a removal): one family, so reading a book's notes again, or
 * forgetting them, takes all of it.
 */
export const notesKey = (book: string) => ['notes', book] as const;
const countKey = (book: string) => [...notesKey(book), 'count'] as const;
export const openKey = (book: string) => [...notesKey(book), 'open'] as const;

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

/**
 * How many notes a book has, open and done, counted each time it is asked and never shown from
 * an earlier count: what removing its project would delete, notes just written included.
 */
export function useNotesCount(book: string) {
    const port = useNotesPort();
    return useQuery({
        queryKey: countKey(book),
        queryFn: async () => {
            const { open, done } = await port.countNotes(book);
            return open + done;
        },
        gcTime: 0,
        staleTime: 0,
    });
}

/**
 * How many of a book's notes are open (a project's row), read again each time the row shows; the
 * last count shows meanwhile (the backend keeps the notes in memory once read).
 */
export function useOpenNotes(book: string) {
    const port = useNotesPort();
    return useQuery({
        queryKey: openKey(book),
        queryFn: async () => (await port.countNotes(book)).open,
        staleTime: 0,
    });
}

/**
 * Forgets what is kept of some books' notes, changed outside the Notes panel (a project merged into
 * another): read again when they show.
 */
export function useForgetBooks() {
    const client = useQueryClient();
    return useCallback(
        (books: readonly string[]) => {
            for (const book of books) void client.invalidateQueries({ queryKey: notesKey(book) });
        },
        [client],
    );
}
