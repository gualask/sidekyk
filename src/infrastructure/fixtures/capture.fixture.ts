import type { CaptureEvent, Note, NotesPort } from '@/modules/notes';
import { REPOSITORY_IMAGES } from './fixture-files';
import { failure, newId } from './scenario';

/** The capture's part of the notes port. */
export type FixtureCapturePort = Pick<
    NotesPort,
    | 'canCapture'
    | 'startCapture'
    | 'onCapture'
    | 'writeCapture'
    | 'dropCrops'
    | 'cropPng'
    | 'cropUrl'
    | 'openCaptureSettings'
>;

/**
 * The capture in a browser tab: a capture picks the hero image a moment later, as if an area had
 * been dragged, and the capture window opens on it (`onTaken`), as the backend opens it. A draft's
 * crops are the hero image's bytes; writing one goes through the notes' own commands.
 */
export function fixtureCapture(
    notes: Pick<NotesPort, 'addImage' | 'markImage' | 'setNoteText'> & {
        /** A note of a book, as it is. */
        note: (book: string, id: string) => Note;
    },
    onTaken: (width: number, height: number) => void,
): FixtureCapturePort {
    const crops = new Map<string, Uint8Array<ArrayBuffer>>();
    /** A crop's bytes; one the draft no longer holds fails. */
    const cropOf = (crop: string) => {
        const bytes = crops.get(crop);
        if (!bytes) throw failure('unknown');
        return bytes;
    };
    const listeners = new Set<(event: CaptureEvent) => void>();
    const heroUrl = REPOSITORY_IMAGES['public/hero.png'].url;
    return {
        canCapture: async () => true,
        startCapture: async (into) => {
            const area = await fetch(heroUrl);
            const bytes = new Uint8Array(await area.arrayBuffer());
            const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
            const { width, height } = bitmap;
            bitmap.close();
            const crop = newId();
            crops.set(crop, bytes);
            setTimeout(() => {
                for (const listener of listeners) {
                    listener({ kind: 'taken', crop, width, height, into });
                }
                onTaken(width, height);
            }, 300);
        },
        onCapture: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        // as the backend's `write_capture`, step by step: the note with its first crop, the
        // others after it, the marks, the text
        writeCapture: async ({ book, target, text, images }) => {
            let found = target.kind === 'note' ? notes.note(book, target.id) : null;
            for (const image of images) {
                const before = found?.images.length ?? 0;
                if (image.kind === 'crop') {
                    const into = found ? ({ kind: 'note', id: found.id } as const) : target;
                    found = await notes.addImage(book, into, cropOf(image.crop));
                }
                const id = image.kind === 'crop' ? found?.images[before]?.id : image.id;
                if (found && id && (image.marks.length > 0 || image.kind === 'image')) {
                    found = await notes.markImage(book, found.id, id, image.marks, image.drawn);
                }
            }
            if (!found) throw failure('unknown');
            if (text !== null) found = await notes.setNoteText(book, found.id, text);
            for (const image of images) if (image.kind === 'crop') crops.delete(image.crop);
            return found;
        },
        dropCrops: async (dropped) => {
            for (const crop of dropped) crops.delete(crop);
        },
        cropPng: async (crop) =>
            new Blob([crops.get(crop) ?? new Uint8Array()], { type: 'image/png' }),
        cropUrl: () => heroUrl,
        openCaptureSettings: async () => undefined,
    };
}
