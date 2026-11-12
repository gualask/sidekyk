import { Dialog } from '@base-ui/react/dialog';
import {
    IconChevronLeft,
    IconChevronRight,
    IconCopy,
    IconPencil,
    IconX,
} from '@tabler/icons-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { fileSize } from '@/shared/format/file-size';
import { useTranslation } from '@/shared/i18n';
import { copyLabel, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import { useNotesPort } from '../../../application/notes.port';
import { sourceImage } from '../../../model/notes';
import type { Mark, Note, NoteImage } from '../../../model/notes.types';
import { drawnPng } from '../../mark-editor/drawing/draw-marks';
import { MarkEditor } from '../../mark-editor/MarkEditor';

/**
 * A note's image large, over the app: fitted, never scaled up; `←`/`→` go through the note's
 * images, `Esc` or a click outside closes. "Copy image" puts it on the clipboard as PNG;
 * "Annotate" opens its marks (`MarkEditor`), which keep the viewer open until they end. A capture's
 * (`captured`, where its note went) opens on its marks, and closes when they end: Done keeps it,
 * Cancel discards it (`onDiscard`).
 */
export function ImageViewer({
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
    const marks = useMarking(captured !== null);
    const { marking } = marks;
    const { images } = note;
    const image = images[index];
    const many = images.length > 1;
    const go = (step: number) => onIndex((index + step + images.length) % images.length);

    /** Keeps the marks, drawn over the image as given; whether the editor may close. */
    const keepMarks = async (kept: Mark[] | null) => {
        if (kept) {
            const given = sourceImage(image);
            const saved = await actions.markImage(note, image, kept, async () =>
                kept.length === 0
                    ? null
                    : drawnPng(await port.imagePng(book, given), kept, image.width, image.height),
            );
            if (!saved) return false;
        }
        if (captured !== null) {
            onClose();
            return true;
        }
        marks.end();
        return true;
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
                            onCancel={captured === null ? marks.end : onDiscard}
                        />
                    ) : (
                        <>
                            <ViewerHeader
                                image={image}
                                index={index}
                                count={images.length}
                                onGo={go}
                                annotate={marks.annotate}
                                onAnnotate={marks.start}
                                copyTitle={copyLabel(copied, t('notes.copyImage'), i18n)}
                                onCopy={() => void copyImage(image.id, port.imagePng(book, image))}
                            />
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

/**
 * Whether the image's marks are open. Once they end, the focus goes back to what opened them
 * (`annotate`), so `Esc` closes the viewer next.
 */
function useMarking(initial: boolean) {
    const [marking, setMarking] = useState(initial);
    const annotate = useRef<HTMLButtonElement>(null);
    const marked = useRef(false);
    useEffect(() => {
        if (marking || !marked.current) return;
        marked.current = false;
        annotate.current?.focus();
    }, [marking]);
    return {
        marking,
        annotate,
        start: () => setMarking(true),
        /** Back to the image, the focus on what opened the marks. */
        end: () => {
            marked.current = true;
            setMarking(false);
        },
    };
}

/**
 * Above the image: its size; with several, its place among them and the buttons going through
 * them; then Annotate, Copy image and ×.
 */
function ViewerHeader({
    image,
    index,
    count,
    onGo,
    annotate,
    onAnnotate,
    copyTitle,
    onCopy,
}: {
    image: NoteImage;
    index: number;
    count: number;
    onGo: (step: number) => void;
    annotate: RefObject<HTMLButtonElement | null>;
    onAnnotate: () => void;
    copyTitle: string;
    onCopy: () => void;
}) {
    const i18n = useTranslation();
    const { t } = i18n;
    return (
        <header className="flex items-center gap-1 pb-2 pl-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-ui-text-muted tabular-nums">
                {t('notes.imageSize', {
                    width: image.width,
                    height: image.height,
                    size: fileSize(image.bytes, i18n.formatTag),
                })}
            </span>
            {count > 1 ? (
                <>
                    <span className="px-1 text-xs text-ui-text-muted tabular-nums">
                        {index + 1}/{count}
                    </span>
                    <button
                        type="button"
                        className="btn-icon h-7 w-7"
                        title={t('notes.previousImage')}
                        aria-label={t('notes.previousImage')}
                        onClick={() => onGo(-1)}
                    >
                        <IconChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        className="btn-icon h-7 w-7"
                        title={t('notes.nextImage')}
                        aria-label={t('notes.nextImage')}
                        onClick={() => onGo(1)}
                    >
                        <IconChevronRight size={16} />
                    </button>
                </>
            ) : null}
            <button ref={annotate} type="button" className="btn-ghost-sm" onClick={onAnnotate}>
                <IconPencil size={14} />
                {t('notes.annotate')}
            </button>
            <button type="button" className="btn-ghost-sm" title={copyTitle} onClick={onCopy}>
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
    );
}
