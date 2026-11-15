import {
    type KeyboardEvent,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { useTranslation } from '@/shared/i18n';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useCaptureDraft, useDropCrops, useWriteCapture } from '../../application/captures';
import { useNotesPort } from '../../application/notes.port';
import { useNotesSettings } from '../../application/notes-settings';
import {
    type CaptureDraft,
    type CaptureFocus,
    canRemove,
    type DraftImage,
    draftChanged,
    draftCrops,
    draftImageId,
    enterAction,
    steppedTo,
    withHistory,
    withoutCrop,
} from '../../model/capture-draft';
import { marksBesides } from '../../model/marks';
import { sourceImage } from '../../model/notes';
import { DiscardDialog } from '../DiscardDialog';
import { useChoice } from '../destination-field/use-choice';
import { drawnPng } from '../mark-editor/drawing/draw-marks';
import { linesClass, wrapLines } from '../notes-layout';
import { CaptureFoot } from './CaptureFoot';
import { enterKeys } from './enter-keys';
import { ImageEditor } from './ImageEditor';
import { ImageStrip } from './ImageStrip';
import { useCaptureDestination, whereTo } from './use-capture-destination';

/**
 * The capture window (`docs/features/capture.md`): the draft's image selected with its marks, the
 * strip of its images and the + that captures another area into it, the text, and where the note
 * goes (Move's field, or the note it is for), the keys at the bottom right. `↵` writes the note
 * and closes, `⌘↵` copies it too, for an agent; `Esc` (or `closeAsked`, the window's `⌘W`)
 * discards the draft, asking first when it has marks or text. In a window larger than `size`
 * (full screen) it sits in the middle.
 */
export function CaptureWindow({
    size,
    closeAsked,
    onDone,
}: {
    size: { width: number; height: number };
    /** Counts the window's asks to close: each one is `Esc`. */
    closeAsked: number;
    onDone: () => void;
}) {
    const { draft } = useCaptureDraft();
    // the draft as last shown, while the window closes after it ended
    const shown = useRef<CaptureDraft | null>(null);
    if (draft) shown.current = draft;
    const held = draft ?? shown.current;
    return (
        <main
            className="flex h-screen w-screen items-center justify-center bg-ui-bg font-sans"
            // the layout, hidden under the window, keeps its window keys: these are its own
            onKeyDown={(event) => event.stopPropagation()}
        >
            {/* the window's size as the backend makes it (`compact_frame.rs`), for a larger one */}
            <section
                className="flex flex-col bg-ui-surface min-[600px]:rounded-xl"
                style={{
                    width: `min(100vw, ${size.width}px)`,
                    height: `min(100vh, ${size.height}px)`,
                }}
            >
                {held ? (
                    <CaptureForm
                        draft={held}
                        live={draft !== null}
                        closeAsked={closeAsked}
                        onDone={onDone}
                    />
                ) : null}
            </section>
        </main>
    );
}

function CaptureForm({
    draft,
    live,
    closeAsked,
    onDone,
}: {
    draft: CaptureDraft;
    /** The draft is still the one held: not one ended, shown while the window closes. */
    live: boolean;
    closeAsked: number;
    onDone: () => void;
}) {
    const { t } = useTranslation();
    const port = useNotesPort();
    const settings = useNotesSettings();
    const { update, end } = useCaptureDraft();
    const dropCrops = useDropCrops();
    const write = useWriteCapture(drawnPng);
    const { copyLater } = useCopyToClipboard();
    const imageRoot = useRef<HTMLDivElement>(null);
    const text = useRef<HTMLTextAreaElement>(null);
    const where = useRef<HTMLInputElement>(null);
    const destination = useCaptureDestination(draft, live);
    const choice = useChoice(live, destination);
    const [busy, setBusy] = useState(false);
    const [asking, setAsking] = useState(false);
    const { destination: goes } = draft;
    const book = goes.kind === 'note' ? goes.book : (destination.state.chip?.book ?? null);
    const index = Math.min(draft.selected, draft.images.length - 1);
    const image = draft.images[index];

    useLayoutEffect(() => wrapLines(text.current, settings.lines), [settings.lines]);
    useEffect(() => {
        imageRoot.current?.focus();
    }, []);

    /**
     * Ends the draft: the window goes back as it was, then the draft is let go with its crops but
     * `written`, a note's now (a crop may have joined it while the note was written).
     */
    const close = (written: readonly string[] = []) => {
        onDone();
        const ended = end();
        dropCrops(draftCrops(ended).filter((crop) => !written.includes(crop)));
    };

    const discard = () => {
        if (busy) return;
        if (draftChanged(draft)) {
            setAsking(true);
            return;
        }
        close();
    };

    // `⌘W`: as `Esc`, each time it is asked
    useOnEachAsk(closeAsked, discard);

    const submit = async (copy: boolean) => {
        if (busy || !live) return;
        const to = whereTo(draft, destination);
        if (!to) {
            where.current?.focus();
            return;
        }
        setBusy(true);
        const written = write(draft, to);
        if (copy) {
            void copyLater(
                'capture',
                written.then((note) =>
                    note
                        ? port.copyNote(to.book, note.id)
                        : Promise.reject(new Error('not written')),
                ),
            );
        }
        const note = await written;
        setBusy(false);
        if (note) close(draftCrops(draft));
    };

    /** `↵` where the focus is: writes the note, with `⌘` copies it too; else it is not this one's. */
    const onEnter = (event: KeyboardEvent, focus: CaptureFocus, selected: boolean): boolean => {
        const action = enterAction(focus, enterKeys(event, selected));
        if (action !== 'write' && action !== 'writeAndCopy') return false;
        event.preventDefault();
        void submit(action === 'writeAndCopy');
        return true;
    };

    const imageKey = (event: KeyboardEvent<HTMLDivElement>, selected: boolean) => {
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
        if (event.key === 'Escape') {
            event.preventDefault();
            discard();
        } else if (event.key === 'Enter') {
            onEnter(event, 'image', selected);
        } else if (event.key === 'Tab' && plain && !event.shiftKey) {
            event.preventDefault();
            text.current?.focus();
        } else if (
            (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
            !selected &&
            plain
        ) {
            event.preventDefault();
            update((held) => steppedTo(held, event.key === 'ArrowLeft' ? -1 : 1));
        }
    };

    const textKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
        if (event.key === 'Escape') {
            event.preventDefault();
            discard();
        } else if (event.key === 'Enter') {
            onEnter(event, 'text', false);
        } else if (event.key === 'Tab' && plain) {
            event.preventDefault();
            if (event.shiftKey) imageRoot.current?.focus();
            else (where.current ?? imageRoot.current)?.focus();
        }
    };

    return (
        <>
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3.5 pb-2">
                {image ? (
                    <ImageEditor
                        root={imageRoot}
                        id={draftImageId(image)}
                        src={imageSrc(port, book, image, false)}
                        width={image.kind === 'crop' ? image.width : image.image.width}
                        height={image.kind === 'crop' ? image.height : image.image.height}
                        history={image.history}
                        onHistory={(change) => update((held) => withHistory(held, index, change))}
                        taken={marksBesides(
                            draft.images.map((held) => held.history.present),
                            index,
                        )}
                        disabled={busy}
                        onKey={imageKey}
                    />
                ) : null}
                <ImageStrip
                    images={draft.images}
                    selected={index}
                    thumbUrl={(shownImage) => imageSrc(port, book, shownImage, true)}
                    removable={(at) => canRemove(draft, at)}
                    onSelect={(at) => {
                        update((held) => ({ ...held, selected: at }));
                        imageRoot.current?.focus();
                    }}
                    onRemove={(at) => {
                        const gone = draft.images[at];
                        if (gone?.kind === 'crop') dropCrops([gone.crop]);
                        update((held) => withoutCrop(held, at));
                    }}
                    onCapture={() => void port.startCapture({ kind: 'last' })}
                />
                <textarea
                    ref={text}
                    rows={2}
                    spellCheck={false}
                    value={draft.text}
                    placeholder={t('quickNote.placeholder')}
                    aria-label={t('notes.note')}
                    className={`shrink-0 resize-none bg-transparent text-[15px]/[1.5] text-ui-text outline-none placeholder:text-ui-text-muted ${linesClass(settings.lines)}`}
                    onChange={(event) => {
                        const value = event.target.value;
                        update((held) => ({ ...held, text: value }));
                    }}
                    onKeyDown={textKey}
                />
            </div>
            <CaptureFoot
                draft={draft}
                destination={destination}
                choice={choice}
                where={where}
                onWrite={() => void submit(false)}
                onText={() => text.current?.focus()}
            />
            <DiscardDialog
                open={asking}
                title={t('notes.discardCaptureTitle')}
                text={t('notes.discardCaptureText')}
                keep={t('notes.keepCapturing')}
                onKeep={() => setAsking(false)}
                onDiscard={() => {
                    setAsking(false);
                    close();
                }}
            />
        </>
    );
}

/** Runs `run` each time `asks` (a count of asks) goes up after the first render. */
function useOnEachAsk(asks: number, run: () => void) {
    const before = useRef(asks);
    const asked = useEffectEvent(run);
    useEffect(() => {
        if (asks === before.current) return;
        before.current = asks;
        asked();
    }, [asks]);
}

/**
 * Where an image of the draft loads: a crop from the backend's crops; a note's image under its
 * marks (they are drawn over it), its thumbnail as it is.
 */
function imageSrc(
    port: ReturnType<typeof useNotesPort>,
    book: string | null,
    image: DraftImage,
    thumb: boolean,
): string {
    if (image.kind === 'crop') return port.cropUrl(image.crop, thumb);
    return port.imageUrl(book ?? '', thumb ? image.image : sourceImage(image.image), thumb);
}
