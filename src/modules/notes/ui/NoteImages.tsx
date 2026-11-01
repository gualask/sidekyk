import { Dialog } from '@base-ui/react/dialog';
import { IconChevronLeft, IconChevronRight, IconCopy, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { fileSize } from '@/shared/format/file-size';
import { useTranslation } from '@/shared/i18n';
import { copyLabel, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useNotesPort } from '../application/notes.port';
import type { NoteActions } from '../application/notes.queries';
import { thumbBox } from '../model/notes';
import type { Note, NoteImage } from '../model/notes.types';

/**
 * A note's images below its text: thumbnails of a fixed height, so the card's never moves while
 * they load. A click opens the image large; on hover a × takes it out (with Undo).
 */
export function NoteImages({
    book,
    note,
    actions,
}: {
    book: string;
    note: Note;
    actions: NoteActions;
}) {
    const port = useNotesPort();
    const [open, setOpen] = useState<number | null>(null);
    const { t } = useTranslation();
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
                    book={book}
                    images={note.images}
                    index={open}
                    onIndex={setOpen}
                    onClose={() => setOpen(null)}
                />
            ) : null}
        </>
    );
}

/**
 * A note's image large, over the app: fitted, never scaled up; `←`/`→` go through the note's
 * images, `Esc` or a click outside closes. "Copy image" puts it on the clipboard as PNG.
 */
function ImageViewer({
    book,
    images,
    index,
    onIndex,
    onClose,
}: {
    book: string;
    images: NoteImage[];
    index: number;
    onIndex: (index: number) => void;
    onClose: () => void;
}) {
    const port = useNotesPort();
    const i18n = useTranslation();
    const { t } = i18n;
    const { copied, copyImage } = useCopyToClipboard();
    const image = images[index];
    const many = images.length > 1;
    const go = (step: number) => onIndex((index + step + images.length) % images.length);
    const copyTitle = copyLabel(copied, t('notes.copyImage'), i18n);

    return (
        <Dialog.Root
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    className="fixed inset-6 z-50 flex flex-col rounded-xl bg-ui-surface p-2 shadow-xl outline-none"
                    aria-label={t('notes.image')}
                    onKeyDown={(event) => {
                        if (!many) return;
                        if (event.key === 'ArrowLeft') go(-1);
                        else if (event.key === 'ArrowRight') go(1);
                    }}
                >
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
                            type="button"
                            className="btn-ghost-sm"
                            title={copyTitle}
                            onClick={() => void copyImage(image.id, port.imagePng(book, image))}
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
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
