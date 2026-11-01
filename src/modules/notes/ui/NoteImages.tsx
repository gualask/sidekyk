import { Dialog } from '@base-ui/react/dialog';
import {
    IconChevronLeft,
    IconChevronRight,
    IconCopy,
    IconPencil,
    IconX,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { fileSize } from '@/shared/format/file-size';
import { useTranslation } from '@/shared/i18n';
import { copyLabel, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useNotesPort } from '../application/notes.port';
import type { NoteActions } from '../application/notes.queries';
import { sourceImage, thumbBox } from '../model/notes';
import type { Mark, Note } from '../model/notes.types';
import { drawnPng } from './draw-marks';
import { MarkEditor } from './MarkEditor';

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
    const port = useNotesPort();
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
                {note.images.map((image, index) => {
                    const box = thumbBox(image);
                    return (
                        <li key={image.id} className="group/image relative">
                            <button
                                type="button"
                                className="block overflow-hidden rounded-md bg-ui-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                                title={t('notes.openImage')}
                                onClick={() => setOpen(index)}
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
                                onClick={() => void actions.removeImage(note, image)}
                            >
                                <IconX size={12} stroke={2.5} />
                            </button>
                        </li>
                    );
                })}
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

/**
 * A note's image large, over the app: fitted, never scaled up; `←`/`→` go through the note's
 * images, `Esc` or a click outside closes. "Copy image" puts it on the clipboard as PNG;
 * "Annotate" opens its marks (`MarkEditor`), which keep the viewer open until they end. A capture's
 * (`captured`, where its note went) opens on its marks, and closes when they end: Done keeps it,
 * Cancel discards it (`onDiscard`).
 */
function ImageViewer({
    book,
    note,
    actions,
    index,
    captured,
    onIndex,
    onClose,
    onDiscard,
}: {
    book: string;
    note: Note;
    actions: NoteActions;
    index: number;
    captured: string | null;
    onIndex: (index: number) => void;
    onClose: () => void;
    onDiscard: () => void;
}) {
    const port = useNotesPort();
    const i18n = useTranslation();
    const { t } = i18n;
    const { copied, copyImage } = useCopyToClipboard();
    const [marking, setMarking] = useState(captured !== null);
    // the marks ended, the focus goes back to what opened them, so `Esc` closes the viewer next
    const annotate = useRef<HTMLButtonElement>(null);
    const marked = useRef(false);
    useEffect(() => {
        if (marking || !marked.current) return;
        marked.current = false;
        annotate.current?.focus();
    }, [marking]);
    const { images } = note;
    const image = images[index];
    const many = images.length > 1;
    const go = (step: number) => onIndex((index + step + images.length) % images.length);
    const copyTitle = copyLabel(copied, t('notes.copyImage'), i18n);

    /** Keeps the marks, drawn over the image as given; whether the editor may close. */
    const keepMarks = async (marks: Mark[] | null) => {
        if (marks) {
            const given = sourceImage(image);
            const kept = await actions.markImage(note, image, marks, async () =>
                marks.length === 0
                    ? null
                    : drawnPng(await port.imagePng(book, given), marks, image.width, image.height),
            );
            if (!kept) return false;
        }
        if (captured !== null) {
            onClose();
            return true;
        }
        endMarks();
        return true;
    };

    /** Back to the image, the focus on what opened the marks. */
    const endMarks = () => {
        marked.current = true;
        setMarking(false);
    };

    return (
        <Dialog.Root
            open
            disablePointerDismissal={marking}
            onOpenChange={(open) => {
                // marking, `Esc` cancels the marks (the editor's), not the viewer
                if (!open && !marking) onClose();
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    className="fixed inset-6 z-20 flex flex-col rounded-xl bg-ui-surface p-2 shadow-xl outline-none"
                    aria-label={t('notes.image')}
                    onKeyDown={(event) => {
                        if (!many || marking) return;
                        if (event.key === 'ArrowLeft') go(-1);
                        else if (event.key === 'ArrowRight') go(1);
                    }}
                >
                    {marking ? (
                        <MarkEditor
                            key={image.id}
                            book={book}
                            image={image}
                            place={captured}
                            onDone={keepMarks}
                            onCancel={captured === null ? endMarks : onDiscard}
                        />
                    ) : (
                        <>
                            <header className="flex items-center gap-1 pb-2 pl-1.5">
                                <span className="min-w-0 flex-1 truncate text-xs text-ui-text-muted tabular-nums">
                                    {t('notes.imageSize', {
                                        width: image.width,
                                        height: image.height,
                                        size: fileSize(image.bytes, i18n.formatTag),
                                    })}
                                </span>
                                {many ? (
                                    <>
                                        <span className="px-1 text-xs text-ui-text-muted tabular-nums">
                                            {index + 1}/{images.length}
                                        </span>
                                        <button
                                            type="button"
                                            className="btn-icon h-7 w-7"
                                            title={t('notes.previousImage')}
                                            aria-label={t('notes.previousImage')}
                                            onClick={() => go(-1)}
                                        >
                                            <IconChevronLeft size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-icon h-7 w-7"
                                            title={t('notes.nextImage')}
                                            aria-label={t('notes.nextImage')}
                                            onClick={() => go(1)}
                                        >
                                            <IconChevronRight size={16} />
                                        </button>
                                    </>
                                ) : null}
                                <button
                                    ref={annotate}
                                    type="button"
                                    className="btn-ghost-sm"
                                    onClick={() => setMarking(true)}
                                >
                                    <IconPencil size={14} />
                                    {t('notes.annotate')}
                                </button>
                                <button
                                    type="button"
                                    className="btn-ghost-sm"
                                    title={copyTitle}
                                    onClick={() =>
                                        void copyImage(image.id, port.imagePng(book, image))
                                    }
                                >
                                    <IconCopy size={14} />
                                    {copyTitle}
                                </button>
                                <Dialog.Close
                                    className="btn-icon h-7 w-7"
                                    title={t('notes.closeImage')}
                                    aria-label={t('notes.closeImage')}
                                >
                                    <IconX size={16} />
                                </Dialog.Close>
                            </header>
                            <div className="grid min-h-0 flex-1 place-items-center overflow-hidden">
                                <img
                                    key={image.id}
                                    src={port.imageUrl(book, image, false)}
                                    alt={t('notes.image')}
                                    width={image.width}
                                    height={image.height}
                                    className="h-auto max-h-full w-auto max-w-full object-contain"
                                    decoding="async"
                                    draggable={false}
                                />
                            </div>
                        </>
                    )}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
