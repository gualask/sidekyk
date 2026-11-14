import { IconScreenshot, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import { useNotesPort } from '../../../application/notes.port';
import { thumbBox } from '../../../model/notes';
import type { Note, NoteImage } from '../../../model/notes.types';
import { ImageViewer } from './ImageViewer';

/**
 * A note's images below its text: thumbnails of a fixed height, so the card's never moves while
 * they load. A click opens the image large; on hover a × takes it out (with Undo). While the note
 * is edited, an icon after them captures an area into it (`onCapture`).
 */
export function NoteImages({
    book,
    note,
    actions,
    onCapture,
}: {
    book: string;
    note: Note;
    actions: NoteActions;
    onCapture: (() => void) | null;
}) {
    const [open, setOpen] = useState<number | null>(null);
    const { t } = useTranslation();
    if (note.images.length === 0 && !onCapture) return null;
    return (
        <>
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={t('notes.images')}>
                {note.images.map((image, index) => (
                    <Thumbnail
                        key={image.id}
                        book={book}
                        image={image}
                        onOpen={() => setOpen(index)}
                        onRemove={() => void actions.removeImage(note, image)}
                    />
                ))}
                {onCapture ? (
                    <li className="self-center">
                        <button
                            type="button"
                            className="btn-icon h-7 w-7"
                            title={t('notes.addCapture')}
                            aria-label={t('notes.addCapture')}
                            // the card stays edited: a click here is no click outside it
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={onCapture}
                        >
                            <IconScreenshot size={16} />
                        </button>
                    </li>
                ) : null}
            </ul>
            {open !== null && note.images[open] ? (
                <ImageViewer
                    book={book}
                    note={note}
                    actions={actions}
                    index={open}
                    onIndex={setOpen}
                    onClose={() => setOpen(null)}
                />
            ) : null}
        </>
    );
}

/** An image's thumbnail, which opens it large, and on hover its ×, which takes it out. */
function Thumbnail({
    book,
    image,
    onOpen,
    onRemove,
}: {
    book: string;
    image: NoteImage;
    onOpen: () => void;
    onRemove: () => void;
}) {
    const port = useNotesPort();
    const { t } = useTranslation();
    const box = thumbBox(image);
    return (
        <li className="group/image relative">
            <button
                type="button"
                className="block overflow-hidden rounded-md bg-ui-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                title={t('notes.openImage')}
                onClick={onOpen}
            >
                <img
                    src={port.imageUrl(book, image, true)}
                    alt={t('notes.image')}
                    width={box.width}
                    height={box.height}
                    style={box}
                    className="block object-cover"
                    decoding="async"
                    draggable={false}
                />
            </button>
            <button
                type="button"
                className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-ui-surface text-ui-text-secondary opacity-0 group-hover/image:opacity-100 hover:text-ui-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                title={t('notes.removeImage')}
                aria-label={t('notes.removeImage')}
                onClick={onRemove}
            >
                <IconX size={12} stroke={2.5} />
            </button>
        </li>
    );
}
