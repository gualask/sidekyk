import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { type CaptureEvent, type ImageDrop, imageFile, type NotesPort } from '@/modules/notes';
import { attachListener, onTauriEvent } from './events';

/** The last part of a path, whichever separator it uses. */
function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Follows the system's file drags over the webview (Tauri takes them all: the page never sees
 * them), positions in CSS pixels. A drop's files are read by the backend, from their paths.
 */
function onImageDrop(listener: (drop: ImageDrop) => void): () => void {
    const css = (position: { x: number; y: number }) => ({
        x: position.x / window.devicePixelRatio,
        y: position.y / window.devicePixelRatio,
    });
    return attachListener(() =>
        getCurrentWebview().onDragDropEvent(({ payload }) => {
            if (payload.type === 'leave') {
                listener({ kind: 'leave' });
            } else if (payload.type === 'drop') {
                const { paths } = payload;
                listener({
                    kind: 'drop',
                    ...css(payload.position),
                    names: paths.map(fileName),
                    add: (book, target) => invoke('add_note_image_files', { book, target, paths }),
                });
            } else {
                listener({ kind: 'over', ...css(payload.position) });
            }
        }),
    );
}

/** Native notes adapter: the commands in `src-tauri/src/interfaces/tauri/notes.rs`. */
export const tauriNotes: NotesPort = {
    getNotes: (book) => invoke('get_notes', { book }),
    addNote: (book, list, text) => invoke('add_note', { book, list, text }),
    setNoteText: (book, id, text) => invoke('set_note_text', { book, id, text }),
    setNoteDone: (book, id, done) => invoke('set_note_done', { book, id, done }),
    placeNote: (book, id, list, index) => invoke('place_note', { book, id, list, index }),
    restoreNote: (book, note) => invoke('restore_note', { book, note }),
    deleteNote: (book, id) => invoke('delete_note', { book, id }),
    moveNote: (from, id, to, list) => invoke('move_note', { from, id, to, list }),
    unmoveNote: (at, original, home) => invoke('unmove_note', { at, original, home }),
    moveList: (from, list, to) => invoke('move_list', { from, list, to }),
    unmoveList: (moved) => invoke('unmove_list', { moved }),
    addList: (book, name) => invoke('add_note_list', { book, name }),
    renameList: (book, id, name) => invoke('rename_note_list', { book, id, name }),
    deleteList: (book, id) => invoke('delete_note_list', { book, id }),
    restoreList: (book, deleted) => invoke('restore_note_list', { book, deleted }),
    openList: (book, id) => invoke('open_note_list', { book, id }),
    countNotes: (book) => invoke('count_notes', { book }),
    exportNotes: (projectId) => invoke('export_notes', { projectId }),
    // the bytes cross raw, as the body; the book and the target as headers (`notes.rs`, `pasted`)
    addImage: (book, target, bytes) =>
        invoke('add_note_image', bytes, {
            headers: { 'x-book': encodeURIComponent(book), 'x-target': JSON.stringify(target) },
        }),
    // `mark_note_image`: the marking as a line of JSON, then the PNG raw
    markImage: (book, id, image, marks, drawn) => {
        const line = new TextEncoder().encode(`${JSON.stringify({ book, id, image, marks })}\n`);
        const body = new Uint8Array(line.length + (drawn?.length ?? 0));
        body.set(line);
        if (drawn) body.set(drawn, line.length);
        return invoke('mark_note_image', body);
    },
    removeImage: (book, id, image) => invoke('remove_note_image', { book, id, image }),
    copyNote: (book, id) => invoke('copy_note', { book, id }),
    imagePng: async (book, image) =>
        new Blob(
            [await invoke<ArrayBuffer>('note_image_png', { book, file: imageFile(image, false) })],
            {
                type: 'image/png',
            },
        ),
    // `note_image.rs`: the book and the file encoded whole, the book once before (an older id is
    // a path)
    imageUrl: (book, image, thumb) =>
        convertFileSrc(`${encodeURIComponent(book)}/${imageFile(image, thumb)}`, 'note-image'),
    onImageDrop,
    // `capture.rs`
    canCapture: () => invoke('can_capture'),
    startCapture: () => invoke('start_capture'),
    onCapture: (listener) => onTauriEvent<CaptureEvent>('capture', listener),
    addCapture: (book) => invoke('add_capture', { book }),
    setMarking: (marking) => invoke('set_marking', { marking }),
    openCaptureSettings: () => invoke('open_capture_settings'),
};
