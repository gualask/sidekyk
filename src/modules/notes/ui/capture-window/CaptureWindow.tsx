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
import { KeyHint } from '@/shared/ui/KeyCaps';
import {
    type CaptureWhere,
    useCaptureDraft,
    useDropCrops,
    useWriteCapture,
} from '../../application/captures';
import { useNotesPort } from '../../application/notes.port';
import { useNotes } from '../../application/notes.queries';
import { useNotesSettings } from '../../application/notes-settings';
import {
    type CaptureDraft,
    type CaptureFocus,
    canRemove,
    chipsPlace,
    type DraftImage,
    draftChanged,
    draftCrops,
    enterAction,
    placeState,
    steppedTo,
    withHistory,
    withoutCrop,
} from '../../model/capture-draft';
import { type MoveSubject, picked } from '../../model/destination';
import { marksBesides } from '../../model/marks';
import { noteTitle, sourceImage } from '../../model/notes';
import { DestinationField } from '../destination-field/DestinationField';
import { useChoice } from '../destination-field/use-choice';
import { type Destination, useDestination } from '../destination-field/use-destination';
import { DiscardDialog } from '../mark-editor/DiscardDialog';
import { drawnPng } from '../mark-editor/drawing/draw-marks';
import { linesClass, wrapLines } from '../notes-layout';
import { enterKeys } from './enter-keys';
import { ImageEditor } from './ImageEditor';
import { ImageStrip } from './ImageStrip';

/** What a capture's new note is, for the destination field: a note being written. */
const NEW_NOTE: MoveSubject = { kind: 'new' };

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
    const { choosing, start, end: endChoice, restore } = useChoice(live, destination);
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
    const askedBefore = useRef(closeAsked);
    const asked = useEffectEvent(discard);
    useEffect(() => {
        if (closeAsked === askedBefore.current) return;
        askedBefore.current = closeAsked;
        asked();
    }, [closeAsked]);

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
                        id={imageId(image)}
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
            <div className="dialog-foot items-center py-2">
                {goes.kind === 'note' ? (
                    <NoteName book={goes.book} id={goes.note} />
                ) : (
                    <DestinationField
                        destination={destination}
                        input={where}
                        label={t('notes.moveWhere')}
                        popup={choosing}
                        place="min-w-0 flex-1"
                        onFocus={start}
                        onBlur={endChoice}
                        onEnter={(row) => {
                            // a suggestion chosen becomes a chip, as with Tab
                            if (row) destination.setState(picked(destination.state, row));
                            else if (destination.state.chip) void submit(false);
                        }}
                        onEscape={() => {
                            restore();
                            text.current?.focus();
                        }}
                    />
                )}
                <CaptureKeys choosing={choosing} where={goes.kind === 'place'} />
            </div>
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

/**
 * The destination field of a draft going to a place: on that place once its book's lists are
 * read (a list chosen by name needs them), then as the user chooses.
 */
function useCaptureDestination(draft: CaptureDraft, live: boolean): Destination {
    const destination = useDestination(NEW_NOTE);
    const place = draft.destination.kind === 'place' ? draft.destination.place : null;
    const { data } = useNotes(place?.book ?? '', place !== null);
    const placed = useRef(false);
    const { books, setState } = destination;
    useEffect(() => {
        if (!live || !place || placed.current || (place.list !== null && !data)) return;
        placed.current = true;
        setState(placeState(place, books, data?.lists));
    }, [live, place, data, books, setState]);
    return destination;
}

/** Where the draft's note goes: the note it is for, or the field's chips; none without a book. */
function whereTo(draft: CaptureDraft, destination: Destination): CaptureWhere | null {
    const goes = draft.destination;
    if (goes.kind === 'note') return { kind: 'note', book: goes.book, note: goes.note };
    const place = chipsPlace(destination.state);
    return place ? { kind: 'new', ...place } : null;
}

function imageId(image: DraftImage): string {
    return image.kind === 'crop' ? image.crop : image.image.id;
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

/** The note a draft adds to, by its title. */
function NoteName({ book, id }: { book: string; id: string }) {
    const { t } = useTranslation();
    const { data } = useNotes(book);
    const note = data?.notes.find((held) => held.id === id);
    return (
        <span className="min-w-0 flex-1 truncate text-xs text-ui-text-secondary">
            {t('notes.captureInto', { title: note ? noteTitle(note.text) : '' })}
        </span>
    );
}

/**
 * The keys the capture window takes, as the focus is in the draft or on its destination (`where`:
 * a field to choose it).
 */
function CaptureKeys({ choosing, where }: { choosing: boolean; where: boolean }) {
    const { t } = useTranslation();
    if (choosing) {
        return (
            <>
                <span>
                    <KeyHint
                        text={t('common.keysChoose')}
                        keys={{ up: 'ArrowUp', down: 'ArrowDown' }}
                    />
                </span>
                <span>
                    <KeyHint text={t('notes.moveComplete')} keys={{ tab: 'Tab' }} />
                </span>
                <span>
                    <KeyHint text={t('quickNote.back')} keys={{ esc: 'Escape' }} />
                </span>
            </>
        );
    }
    return (
        <>
            <span>
                <KeyHint text={t('quickNote.add')} keys={{ enter: 'Enter' }} />
            </span>
            <span>
                <KeyHint text={t('notes.captureKeys')} keys={{ keys: 'Mod+Enter' }} />
            </span>
            {where ? (
                <span>
                    <KeyHint text={t('quickNote.where')} keys={{ tab: 'Tab' }} />
                </span>
            ) : null}
            <span>
                <KeyHint text={t('common.escCloses')} keys={{ esc: 'Escape' }} />
            </span>
        </>
    );
}
