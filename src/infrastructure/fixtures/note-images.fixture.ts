import { addFiles, type ImageDrop, type NoteImage, type NotesPort } from '@/modules/notes';
import { failure, newId } from './scenario';

/** An image as Vite serves it, with its size on disk and in pixels. */
interface ServedImage {
    url: string;
    size: number;
    width: number;
    height: number;
}

/** The notes' images in a browser tab, and where each is, by its id. */
export type FixtureNoteImages = ReturnType<typeof fixtureNoteImages>;

/** The notes' images: Vite's URL for those the fixtures serve, one made for the bytes of others. */
export function fixtureNoteImages() {
    const urls = new Map<string, string>();
    const kept = (url: string) => {
        const id = newId();
        urls.set(id, url);
        return id;
    };
    const keptBytes = (bytes: Uint8Array<ArrayBuffer>, kind: NoteImage['kind']) =>
        kept(URL.createObjectURL(new Blob([bytes], { type: `image/${kind}` })));
    return {
        /** Where the image is: the same for the image and its thumbnail. */
        url: (id: string) => urls.get(id) ?? '',
        /** One the fixtures serve. */
        served: ({ url, size, width, height }: ServedImage): NoteImage => ({
            id: kept(url),
            kind: 'png',
            width,
            height,
            bytes: size,
            marked: null,
        }),
        /** As the backend's `add_images`: a format every webview shows, its size measured. */
        read: async (bytes: Uint8Array<ArrayBuffer>): Promise<NoteImage> => {
            const kind = kindOf(bytes);
            if (!kind) throw failure('image_unsupported');
            const bitmap = await createImageBitmap(
                new Blob([bytes], { type: `image/${kind}` }),
            ).catch(() => {
                throw failure('image_unsupported');
            });
            const image: NoteImage = {
                id: keptBytes(bytes, kind),
                kind,
                width: bitmap.width,
                height: bitmap.height,
                bytes: bytes.length,
                marked: null,
            };
            bitmap.close();
            return image;
        },
        /** A marked image's drawn PNG, under a new id. */
        drawn: (png: Uint8Array<ArrayBuffer>) => keptBytes(png, 'png'),
    };
}

/** The kind of an image's bytes, by their first ones, as the backend tells it; null for others. */
function kindOf(bytes: Uint8Array): NoteImage['kind'] | null {
    const starts = (...head: number[]) => head.every((b, i) => bytes[i] === b);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png';
    if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
    if (starts(0x47, 0x49, 0x46)) return 'gif';
    if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
        return 'webp';
    }
    return null;
}

/**
 * The browser's own file drags, as the app's (`tauri/notes.ts`) follows the system's: the files
 * read here, added one by one through `addImage`, the first making the note the rest join.
 */
export function onBrowserImageDrop(
    addImage: NotesPort['addImage'],
    listener: (drop: ImageDrop) => void,
): () => void {
    const files = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const over = (event: DragEvent) => {
        if (!files(event)) return;
        event.preventDefault();
        listener({ kind: 'over', x: event.clientX, y: event.clientY });
    };
    const leave = (event: DragEvent) => {
        // leaving the page, not moving between its elements
        if (event.relatedTarget === null) listener({ kind: 'leave' });
    };
    const drop = (event: DragEvent) => {
        if (!files(event)) return;
        event.preventDefault();
        const dropped = [...(event.dataTransfer?.files ?? [])];
        listener({
            kind: 'drop',
            x: event.clientX,
            y: event.clientY,
            names: dropped.map((file) => file.name),
            add: (book, target) =>
                addFiles(dropped, target, (to, bytes) => addImage(book, to, bytes)),
        });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
        window.removeEventListener('dragover', over);
        window.removeEventListener('dragleave', leave);
        window.removeEventListener('drop', drop);
    };
}
