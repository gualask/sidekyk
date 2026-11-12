import type { ImageTarget, Note } from '../model/notes.types';
import type { NotesPort } from './notes.port';

/**
 * Images on their way to a note: pasted (`previews` shows them) or dropped (their `names`). `add`
 * gives them to a note, or to a new one, all or none. Whoever holds them revokes the previews.
 */
export interface PendingImages {
    names: string[];
    /** Object URLs of pasted images, revoked once added or dropped. */
    previews: string[];
    add: (target: ImageTarget) => Promise<Note>;
}

/**
 * Adds image files to a note in turn, the first to `target`, the rest to the note it gave: one
 * note, as a drop of several files makes. `add` gives one file's bytes to the backend.
 */
export async function addFiles(
    files: readonly File[],
    target: ImageTarget,
    add: (target: ImageTarget, bytes: Uint8Array<ArrayBuffer>) => Promise<Note>,
): Promise<Note> {
    let note: Note | undefined;
    for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        note = await add(note ? { kind: 'note', id: note.id } : target, bytes);
    }
    if (!note) throw new Error('no file to add');
    return note;
}

/** Images pasted into a book (`files`), with their previews, to be added through the port. */
export function pastedImages(
    port: Pick<NotesPort, 'addImage'>,
    book: string,
    files: readonly File[],
): PendingImages {
    return {
        names: files.map((file) => file.name),
        previews: files.map((file) => URL.createObjectURL(file)),
        add: (target) => addFiles(files, target, (to, bytes) => port.addImage(book, to, bytes)),
    };
}
