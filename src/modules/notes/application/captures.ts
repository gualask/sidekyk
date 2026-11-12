import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { errorToast, type ToastRequest, useShowToast } from '@/shared/ui/toasts';
import { withNotes } from '../model/notes';
import type { CaptureEvent, Note, ProjectNotes } from '../model/notes.types';
import { type NotesPort, useNotesPort } from './notes.port';
import { notesKey, openKey } from './notes.queries';

const captureMarksKey = ['capture-marks'] as const;
const canCaptureKey = ['can-capture'] as const;

/** Whether this system captures, read once: false until the backend answers. */
export function useCanCapture(): boolean {
    const port = useNotesPort();
    return (
        useQuery({
            queryKey: canCaptureKey,
            queryFn: () => port.canCapture(),
            staleTime: Number.POSITIVE_INFINITY,
        }).data ?? false
    );
}

/** A capture's note and its image, whose marks open as the note's card shows. */
export interface PendingMarks {
    note: string;
    image: string;
}

/**
 * The capture whose marks wait for its card, and what ends them. Kept apart from what a panel is
 * asked to show, which comes back each time the panel does: the marks open once.
 */
export function useCaptureMarks() {
    const client = useQueryClient();
    const marks = useQuery<PendingMarks | null>({
        queryKey: captureMarksKey,
        queryFn: () => null,
        initialData: null,
        staleTime: Number.POSITIVE_INFINITY,
    }).data;
    const end = useCallback(() => client.setQueryData(captureMarksKey, null), [client]);
    return { marks, end };
}

/**
 * Follows the captures (the global shortcut, the tray, Notes' button): an area picked becomes a
 * new note on top of the open list of `book()`, asked then (the project on screen, or the
 * Inbox); its marks wait for its card (`useCaptureMarks`), and `onAdded` shows it. The system
 * refusing Sidekyk the screen is told with the way to its settings; a failure with its reason.
 */
export function useCaptures(book: () => string, onAdded: (book: string, note: Note) => void) {
    const port = useNotesPort();
    const client = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();
    const told = useEffectEvent(async (event: CaptureEvent) => {
        const { t } = i18n;
        if (event.kind === 'refused') {
            showToast(refusedToast(i18n, port));
            return;
        }
        if (event.kind === 'failed') {
            showToast({ kind: 'error', title: t('notes.captureFailed') });
            return;
        }
        const into = book();
        try {
            const note = await port.addCapture(into);
            keepCapture(client, into, note);
            onAdded(into, note);
        } catch (error) {
            showToast(errorToast(t('notes.addImageFailed'), error, i18n));
        }
    });
    useEffect(() => {
        // a page loaded again had no marks open, whatever the last one told the backend
        void port.setMarking(false).catch(() => undefined);
        return port.onCapture((event) => void told(event));
    }, [port]);
}

/** The system refusing Sidekyk the screen, with the way to its settings. */
function refusedToast({ t }: Translator, port: NotesPort): ToastRequest {
    return {
        kind: 'error',
        title: t('notes.captureRefused'),
        description: t('notes.captureRefusedHint'),
        action: {
            label: t('notes.captureSettings'),
            run: () => void port.openCaptureSettings(),
        },
    };
}

/**
 * Puts a captured note on top of its book's notes as cached, its row's count read again, and its
 * marks waiting for its card.
 */
function keepCapture(client: QueryClient, into: string, note: Note) {
    client.setQueryData<ProjectNotes>(notesKey(into), (notes) =>
        notes ? withNotes(notes, [note]) : notes,
    );
    void client.invalidateQueries({ queryKey: openKey(into) });
    // a capture's note holds its one image
    const [image] = note.images;
    if (image) {
        client.setQueryData<PendingMarks>(captureMarksKey, {
            note: note.id,
            image: image.id,
        });
    }
}
