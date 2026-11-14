import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { errorToast, type ToastRequest, useShowToast } from '@/shared/ui/toasts';
import {
    type CaptureDraft,
    type CapturePlace,
    type Crop,
    draftImages,
    draftText,
    initialDestination,
    newDraft,
    withCrop,
} from '../model/capture-draft';
import { sourceImage, withNotes } from '../model/notes';
import type {
    CaptureEvent,
    CaptureImage,
    ImageTarget,
    ListTarget,
    Mark,
    Note,
    ProjectNotes,
} from '../model/notes.types';
import { type NotesPort, useNotesPort } from './notes.port';
import { notesKey, openKey } from './notes.queries';

const canCaptureKey = ['can-capture'] as const;
/** The capture window's draft, while it is open: kept apart from any view, as captures add to it. */
const draftKey = ['capture-draft'] as const;
/** The place last chosen for a capture, for the session. */
const lastPlaceKey = ['capture-last-place'] as const;

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

/** A value held for the session in the cache, never fetched. */
function useHeld<T>(key: readonly string[]): T | null {
    return (
        useQuery<T | null>({
            queryKey: key,
            queryFn: () => null,
            initialData: null,
            staleTime: Number.POSITIVE_INFINITY,
            gcTime: Number.POSITIVE_INFINITY,
        }).data ?? null
    );
}

/**
 * The capture window's draft, and what changes or ends it. `end` gives back the draft as it was
 * at its end, crops that joined it a moment before included, for them to be let go.
 */
export function useCaptureDraft() {
    const client = useQueryClient();
    const draft = useHeld<CaptureDraft>(draftKey);
    const update = useCallback(
        (change: (draft: CaptureDraft) => CaptureDraft) =>
            client.setQueryData<CaptureDraft | null>(draftKey, (held) =>
                held ? change(held) : held,
            ),
        [client],
    );
    const end = useCallback((): CaptureDraft | null => {
        const held = client.getQueryData<CaptureDraft | null>(draftKey) ?? null;
        client.setQueryData(draftKey, null);
        return held;
    }, [client]);
    return { draft, update, end };
}

/**
 * Follows the captures (the global shortcut, the tray, Notes, a note's "Add capture", the capture
 * window's +): a crop taken joins the draft open, or starts one going where its entry says, else
 * the place last chosen, else `onScreen()` (the project on screen, if any), else the Inbox. The
 * system refusing Sidekyk the screen is told with the way to its settings; a failure plainly.
 */
export function useCaptures(onScreen: () => string | null) {
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
        const { crop, width, height, into } = event;
        const taken: Crop = { crop, width, height };
        const held = client.getQueryData<CaptureDraft | null>(draftKey);
        if (held) {
            client.setQueryData(draftKey, withCrop(held, taken));
            return;
        }
        const last = client.getQueryData<CapturePlace | null>(lastPlaceKey) ?? null;
        const destination = initialDestination(into, last, onScreen());
        try {
            const note =
                destination.kind === 'note'
                    ? findNote(await bookNotes(client, port, destination.book), destination.note)
                    : null;
            client.setQueryData(draftKey, newDraft(destination, note, taken));
        } catch (error) {
            void port.dropCrops([crop]).catch(() => undefined);
            showToast(errorToast(t('notes.captureFailed'), error, i18n));
        }
    });
    useEffect(() => port.onCapture((event) => void told(event)), [port]);
}

/** A book's notes, from the cache, else read and cached. */
function bookNotes(client: QueryClient, port: NotesPort, book: string): Promise<ProjectNotes> {
    return client.fetchQuery({
        queryKey: notesKey(book),
        queryFn: () => port.getNotes(book),
        staleTime: Number.POSITIVE_INFINITY,
    });
}

function findNote(notes: ProjectNotes, id: string): Note {
    const note = notes.notes.find((note) => note.id === id);
    if (!note) throw new Error(`no note ${id}`);
    return note;
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

/** The PNG of `marks` drawn over the image `png`, `width` x `height` (the editor's drawing). */
export type DrawMarks = (
    png: Blob,
    marks: Mark[],
    width: number,
    height: number,
) => Promise<Uint8Array<ArrayBuffer>>;

/** Where a draft's note goes: a new one on top of a list of a book, or a note there. */
export type CaptureWhere =
    | { kind: 'new'; book: string; list: ListTarget }
    | { kind: 'note'; book: string; note: string };

/**
 * Writes a draft's note in one step: its list made first when new, the marks drawn over each
 * image marked, then the note; cached, the place kept as the last one chosen (not a note's), the
 * crops gone. The note written, or null when it failed (a toast says why, the draft and its crops
 * stay).
 */
export function useWriteCapture(draw: DrawMarks) {
    const port = useNotesPort();
    const client = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();
    return useCallback(
        async (draft: CaptureDraft, where: CaptureWhere): Promise<Note | null> => {
            try {
                const { book } = where;
                const target = await imageTarget(client, port, where);
                const images = await drawn(port, draft, draw, book);
                const note = await port.writeCapture({
                    book,
                    target,
                    text: draftText(draft),
                    images,
                });
                keepWritten(client, book, note);
                if (where.kind === 'new') {
                    client.setQueryData<CapturePlace>(lastPlaceKey, { book, list: note.list });
                }
                return note;
            } catch (error) {
                showToast(errorToast(i18n.t('notes.captureWriteFailed'), error, i18n));
                return null;
            }
        },
        [client, port, draw, showToast, i18n],
    );
}

/** Lets a draft's crops go: its ×, `Esc`. */
export function useDropCrops() {
    const port = useNotesPort();
    return useCallback(
        (crops: string[]) => {
            if (crops.length > 0) void port.dropCrops(crops).catch(() => undefined);
        },
        [port],
    );
}

/** The note the images go to: a note there, or a new one on a list (made first when new). */
async function imageTarget(
    client: QueryClient,
    port: NotesPort,
    where: CaptureWhere,
): Promise<ImageTarget> {
    if (where.kind === 'note') return { kind: 'note', id: where.note };
    const { book, list } = where;
    if (list.kind === 'list') return { kind: 'new', list: list.id };
    if (list.kind === 'open') {
        return { kind: 'new', list: (await bookNotes(client, port, book)).openList };
    }
    const made = await port.addList(book, list.name);
    await client.invalidateQueries({ queryKey: notesKey(book), exact: true });
    return { kind: 'new', list: made.id };
}

/** The draft's images to write, each marked one with its PNG drawn over the image under it. */
function drawn(
    port: NotesPort,
    draft: CaptureDraft,
    draw: DrawMarks,
    book: string,
): Promise<CaptureImage[]> {
    const held = new Map(
        draft.images.map((image) => [image.kind === 'crop' ? image.crop : image.image.id, image]),
    );
    return Promise.all(
        draftImages(draft).map(async (image): Promise<CaptureImage> => {
            if (image.marks.length === 0) return image;
            const own = held.get(image.kind === 'crop' ? image.crop : image.id);
            if (!own) throw new Error('an image of the draft went');
            const png =
                own.kind === 'crop'
                    ? await port.cropPng(own.crop)
                    : await port.imagePng(book, sourceImage(own.image));
            const { width, height } = own.kind === 'crop' ? own : own.image;
            return { ...image, drawn: await draw(png, image.marks, width, height) };
        }),
    );
}

/** A note written, among its book's notes as cached; its row's count read again. */
function keepWritten(client: QueryClient, book: string, note: Note) {
    client.setQueryData<ProjectNotes>(notesKey(book), (notes) =>
        notes ? withNotes(notes, [note]) : notes,
    );
    void client.invalidateQueries({ queryKey: openKey(book) });
}
