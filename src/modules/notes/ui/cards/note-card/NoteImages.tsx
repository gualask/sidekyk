import { IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import { useNotesPort } from '../../../application/notes.port';
import { thumbBox } from '../../../model/notes';
import type { Note, NoteImage } from '../../../model/notes.types';
import { ImageViewer } from './ImageViewer';

/**
 * A note's images below its text: thumbnails of a fixed height, so the card's never moves while
 * they load. A click opens the image large; on hover a × takes it out (with Undo). A capture's
 * opens large with its marks at once; when they end the viewer closes (`onAnnotated`): Done keeps
 * the note, Cancel discards the capture, the note deleted (with Undo).
 */
export function NoteImages({
    book,
    note,
    actions,
    annotate = null,
    place = '',
    onAnnotated = () => undefined,
}: {
    book: string;
    note: Note;
    actions: NoteActions;
    /** A capture's image, just made a note, whose marks open at once. */
    annotate?: string | null;
    /** Where the note went, as the capture's marks name it. */
    place?: string;
    onAnnotated?: (kept: boolean) => void;
}) {
    const [open, setOpen] = useState<number | null>(null);
    // where a capture's note went, while its marks are open
    const [captured, setCaptured] = useState<string | null>(null);
    const { t } = useTranslation();
    const index = annotate ? note.images.findIndex((image) => image.id === annotate) : -1;
    useEffect(() => {
        if (index < 0) return;
        setOpen(index);
        setCaptured(place);
    }, [index, place]);
    const endCapture = (kept: boolean) => {
        setOpen(null);
        setCaptured(null);
        onAnnotated(kept);
    };
    if (note.images.length === 0) return null;
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
            </ul>
            {open !== null && note.images[open] ? (
                <ImageViewer
                    // a capture's marks start a viewer of their own
                    key={captured === null ? 'viewer' : 'capture'}
                    book={book}
                    note={note}
                    actions={actions}
                    index={open}
                    captured={captured}
                    onIndex={setOpen}
                    onClose={() => (captured === null ? setOpen(null) : endCapture(true))}
                    onDiscard={() => {
                        void actions.remove(note);
                        endCapture(false);
                    }}
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
