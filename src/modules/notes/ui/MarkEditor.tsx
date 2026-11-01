import { AlertDialog } from '@base-ui/react/alert-dialog';
import {
    type KeyboardEvent,
    type PointerEvent,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from '@/shared/i18n';
import { shortcutKey } from '@/shared/platform/shortcut';
import { trackDrag } from '@/shared/ui/pointer-drag';
import { useNotesPort } from '../application/notes.port';
import {
    inImage,
    isInLabel,
    labelInside,
    MAX_MARK_TEXT,
    MAX_MARKS,
    type MarkShape,
    markAt,
    markHistory,
    markShape,
    markSize,
    nextLetter,
    redone,
    sameMarks,
    tailHandle,
    undone,
    withMark,
    withMarkText,
    withoutMark,
    withStep,
} from '../model/marks';
import { sourceImage } from '../model/notes';
import type { Mark, MarkPoint, NoteImage } from '../model/notes.types';
import { drawMarks, markFont, markInk, textMeasure } from './draw-marks';

/**
 * In CSS pixels: how near a pointer is on a mark, the radius of a tail's handle and how near it
 * takes it, and how far a press moves before it drags.
 */
const SLACK = 6;
const HANDLE = 6;
const HANDLE_REACH = HANDLE + 3;
const CLICK = 4;

const NO_MARKS: Mark[] = [];

/** The text a mark is being given, before it is kept. */
interface Editing {
    index: number;
    text: string;
}

/**
 * Marks an image of a note, in the viewer: the image as given, fitted, with its marks over it. A
 * click places the next letter, a drag from a spot places it at the release with its tail
 * pointing back; a mark drags, the handle of the one selected moves its tail's tip (dropped on
 * the label, the tail goes); a double click writes its text. `⌘Z`/`⇧⌘Z` undo and redo, `⌫` takes
 * the selected one out. Done ends with `onDone` given the marks (null when unchanged), and
 * whether the editor may go (it stays when they were not saved); Cancel or `Esc` with `onCancel`,
 * after asking when the session changed something. A capture's names where its note went.
 */
export function MarkEditor({
    book,
    image,
    place = null,
    onDone,
    onCancel,
}: {
    book: string;
    image: NoteImage;
    /** Where the note is (a project, the Inbox), for a capture just made a note; else null. */
    place?: string | null;
    onDone: (marks: Mark[] | null) => Promise<boolean>;
    onCancel: () => void;
}) {
    const port = useNotesPort();
    const { t } = useTranslation();
    const { width, height } = image;
    const initial = image.marked?.marks ?? NO_MARKS;
    const [history, setHistory] = useState(() => markHistory(initial));
    const [draft, setDraft] = useState<Mark[] | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [saving, setSaving] = useState(false);
    // Cancel asked whether to drop what the session changed
    const [asking, setAsking] = useState(false);
    const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
    const [fontReady, setFontReady] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const ink = useMemo(markInk, []);
    const selection = useMemo(selectionInk, []);
    const size = markSize(width, height);
    const marks = draft ?? history.present;
    // fitted, never scaled up
    const scale = room ? Math.min(1, room.width / width, room.height / height) : 0;
    const shown = { width: Math.floor(width * scale), height: Math.floor(height * scale) };

    useEffect(() => {
        root.current?.focus();
        const element = stage.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) =>
            setRoom({ width: entry.contentRect.width, height: entry.contentRect.height }),
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // a capture meanwhile would open its marks in place of these: it only shows the window
    useEffect(() => {
        void port.setMarking(true).catch(() => undefined);
        return () => void port.setMarking(false).catch(() => undefined);
    }, [port]);

    useEffect(() => {
        let live = true;
        void document.fonts.load(markFont(size, ink.family)).then(() => {
            if (live) setFontReady(true);
        });
        return () => {
            live = false;
        };
    }, [size, ink.family]);

    // a field opened takes the focus, its text selected: typing replaces the letter
    const editingIndex = editing?.index;
    useEffect(() => {
        if (editingIndex === undefined) return;
        input.current?.focus();
        input.current?.select();
    }, [editingIndex]);

    useLayoutEffect(() => {
        const element = canvas.current;
        const context = element?.getContext('2d');
        // drawn in the font the PNG will have, once it is there
        if (!element || !context || scale === 0 || !fontReady) return;
        const ratio = window.devicePixelRatio || 1;
        const pixels = {
            width: Math.round(shown.width * ratio),
            height: Math.round(shown.height * ratio),
        };
        if (element.width !== pixels.width || element.height !== pixels.height) {
            element.width = pixels.width;
            element.height = pixels.height;
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, element.width, element.height);
        context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
        // the label being written is the field's, over it
        const drawn = editing
            ? withMark(marks, editing.index, { ...marks[editing.index], text: '' })
            : marks;
        const shapes = drawMarks(context, drawn, width, height, ink);
        const shape = selected === null || editing ? undefined : shapes[selected];
        if (shape && marks[selected ?? -1]) {
            drawSelection(
                context,
                shape,
                tailHandle(shape, marks[selected ?? -1]),
                scale,
                selection,
            );
        }
    }, [
        marks,
        selected,
        editing,
        scale,
        shown.width,
        shown.height,
        width,
        height,
        ink,
        selection,
        fontReady,
    ]);

    /** A pointer's place in the image's pixels. */
    const toImage = (event: { clientX: number; clientY: number }): MarkPoint => {
        const rect = canvas.current?.getBoundingClientRect();
        return {
            x: (event.clientX - (rect?.left ?? 0)) / scale,
            y: (event.clientY - (rect?.top ?? 0)) / scale,
        };
    };

    /** The shapes of `list`, to find what a pointer is on: of the marks it acts on, not of the
     * last drawing, which may be behind them. */
    const shapesOf = (list: readonly Mark[]): MarkShape[] => {
        const measure = textMeasure(size, ink);
        return list.map((mark) => markShape(mark, size, measure));
    };

    /** A step kept, every label whole inside the image. */
    const commit = (next: Mark[]) => {
        const shapes = shapesOf(next);
        const inside = next.map((mark, index) => labelInside(mark, shapes[index], width, height));
        setHistory((h) => withStep(h, inside));
    };

    /** The marks with the text being written in. */
    const pending = (): Mark[] =>
        editing ? withMarkText(history.present, editing.index, editing.text) : history.present;

    /** The marks with the text being written kept, the field closed. */
    const settled = (): Mark[] => {
        if (!editing) return history.present;
        const next = pending();
        commit(next);
        setEditing(null);
        if (next.length < history.present.length) setSelected(null);
        return next;
    };

    const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 || saving) return;
        const base = settled();
        const start = toImage(event);
        const far = (pointer: globalThis.PointerEvent) =>
            Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) > CLICK;
        let latest: Mark[] | null = null;
        const show = (next: Mark[]) => {
            latest = next;
            setDraft(next);
        };
        const end = () => {
            setDraft(null);
            return latest;
        };

        const shapes = shapesOf(base);
        const mark = selected === null ? undefined : base[selected];
        const shape = selected === null ? undefined : shapes[selected];
        if (mark && shape && selected !== null) {
            const handle = tailHandle(shape, mark);
            if (Math.hypot(start.x - handle.x, start.y - handle.y) <= HANDLE_REACH / scale) {
                const index = selected;
                trackDrag(
                    event,
                    (pointer) => {
                        if (far(pointer) || latest) {
                            show(
                                withMark(base, index, {
                                    ...mark,
                                    tail: inImage(toImage(pointer), width, height),
                                }),
                            );
                        }
                    },
                    () => {
                        const moved = end()?.[index];
                        if (!moved?.tail) return;
                        const tail = isInLabel(shape, moved.tail) ? null : moved.tail;
                        if (!tail && moved.text.trim() === '') {
                            commit(withoutMark(base, index));
                            setSelected(null);
                        } else {
                            commit(withMark(base, index, { ...moved, tail }));
                        }
                    },
                );
                return;
            }
        }

        const hit = markAt(shapes, start, SLACK / scale);
        if (hit >= 0) {
            setSelected(hit);
            const held = base[hit];
            const offset = { x: start.x - held.x, y: start.y - held.y };
            trackDrag(
                event,
                (pointer) => {
                    if (!far(pointer) && !latest) return;
                    const at = toImage(pointer);
                    const middle = inImage(
                        { x: at.x - offset.x, y: at.y - offset.y },
                        width,
                        height,
                    );
                    show(withMark(base, hit, { ...held, ...middle }));
                },
                () => {
                    const moved = end();
                    if (moved) commit(moved);
                },
            );
            return;
        }

        if (base.length >= MAX_MARKS) return;
        const letter = nextLetter(base);
        const spot = inImage(start, width, height);
        trackDrag(
            event,
            (pointer) => {
                if (!far(pointer) && !latest) return;
                show([
                    ...base,
                    { ...inImage(toImage(pointer), width, height), text: letter, tail: spot },
                ]);
            },
            () => {
                commit(end() ?? [...base, { ...spot, text: letter, tail: null }]);
                setSelected(base.length);
            },
        );
    };

    const onDoubleClick = (event: { clientX: number; clientY: number }) => {
        const hit = markAt(shapesOf(history.present), toImage(event), SLACK / scale);
        if (hit < 0) return;
        setSelected(hit);
        setEditing({ index: hit, text: history.present[hit].text });
    };

    const step = (to: typeof undone) => {
        setHistory(to);
        setSelected(null);
    };

    const done = async () => {
        if (saving) return;
        const final = settled();
        setSaving(true);
        const left = await onDone(sameMarks(final, initial) ? null : final);
        if (!left) setSaving(false);
    };

    /** Leaves without keeping the session's changes: asked first when there are any. */
    const cancel = () => {
        if (saving) return;
        if (sameMarks(pending(), initial)) onCancel();
        else setAsking(true);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // the field's keys are its own, the question's too (its keys reach here through React)
        if (event.target instanceof HTMLInputElement || asking) return;
        const shortcut = shortcutKey(event);
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        } else if ((event.key === 'Backspace' || event.key === 'Delete') && selected !== null) {
            event.preventDefault();
            commit(withoutMark(history.present, selected));
            setSelected(null);
        } else if (event.key === 'Enter' && selected !== null && history.present[selected]) {
            event.preventDefault();
            setEditing({ index: selected, text: history.present[selected].text });
        } else if (shortcut === 'z') {
            event.preventDefault();
            step(event.shiftKey ? redone : undone);
        } else if (shortcut === 'y') {
            event.preventDefault();
            step(redone);
        }
    };

    // the field takes the label's shape, as wide as its text
    const field = editing ? marks[editing.index] : undefined;
    const fieldShape =
        editing && field
            ? markShape({ ...field, text: editing.text || ' ' }, size, textMeasure(size, ink))
            : null;

    return (
        <div
            ref={root}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col outline-none"
            onKeyDown={onKeyDown}
        >
            <header className="flex items-center gap-2 pb-2 pl-1.5">
                {place ? (
                    <span className="max-w-[40%] shrink-0 truncate text-xs font-semibold text-ui-text-secondary">
                        {t('notes.annotateIn', { place })}
                    </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-xs text-ui-text-muted">
                    {t('notes.annotateHint')}
                </span>
                <button type="button" className="btn-ghost-sm" disabled={saving} onClick={cancel}>
                    {t('common.cancel')}
                </button>
                <button
                    type="button"
                    className="btn-primary-sm"
                    disabled={saving}
                    onClick={() => void done()}
                >
                    {t('notes.annotateDone')}
                </button>
            </header>
            <div ref={stage} className="grid min-h-0 flex-1 place-items-center overflow-hidden">
                {scale > 0 ? (
                    <div className="relative" style={shown}>
                        <img
                            src={port.imageUrl(book, sourceImage(image), false)}
                            alt={t('notes.image')}
                            width={shown.width}
                            height={shown.height}
                            className="block"
                            decoding="async"
                            draggable={false}
                        />
                        <canvas
                            ref={canvas}
                            aria-label={t('notes.marks')}
                            className="absolute inset-0 cursor-crosshair touch-none"
                            style={shown}
                            onPointerDown={onPointerDown}
                            onDoubleClick={onDoubleClick}
                        />
                        {editing && fieldShape ? (
                            <input
                                ref={input}
                                aria-label={t('notes.markText')}
                                value={editing.text}
                                maxLength={MAX_MARK_TEXT}
                                className="absolute rounded-full bg-ui-mark px-0 text-center font-bold text-ui-mark-text outline-none ring-2 ring-ui-mark-text"
                                style={{
                                    left: fieldShape.label.x * scale,
                                    top: fieldShape.label.y * scale,
                                    width: fieldShape.label.width * scale,
                                    height: fieldShape.label.height * scale,
                                    fontSize: size * scale,
                                }}
                                onChange={(event) =>
                                    setEditing({ index: editing.index, text: event.target.value })
                                }
                                onBlur={() => void settled()}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        settled();
                                        root.current?.focus();
                                    } else if (event.key === 'Escape') {
                                        event.preventDefault();
                                        setEditing(null);
                                        root.current?.focus();
                                    }
                                }}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>
            <DiscardDialog
                open={asking}
                onKeep={() => setAsking(false)}
                onDiscard={() => {
                    setAsking(false);
                    onCancel();
                }}
            />
        </div>
    );
}

/** Asks before the session's changes are dropped; keeping on is what has the focus. */
function DiscardDialog({
    open,
    onKeep,
    onDiscard,
}: {
    open: boolean;
    onKeep: () => void;
    onDiscard: () => void;
}) {
    const { t } = useTranslation();
    return (
        <AlertDialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) onKeep();
            }}
        >
            <AlertDialog.Portal>
                <AlertDialog.Backdrop className="dialog-backdrop" />
                <AlertDialog.Popup className="dialog-popup top-[22vh] w-[min(400px,calc(100vw-32px))] p-4">
                    <AlertDialog.Title className="text-[15px] font-bold">
                        {t('notes.discardMarksTitle')}
                    </AlertDialog.Title>
                    <AlertDialog.Description className="mt-1.5 text-ui-text-secondary">
                        {t('notes.discardMarksText')}
                    </AlertDialog.Description>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <AlertDialog.Close className="btn-ghost-sm">
                            {t('notes.keepMarking')}
                        </AlertDialog.Close>
                        <button
                            type="button"
                            className="btn-ghost-sm text-ui-danger hover:bg-ui-danger-soft hover:text-ui-danger-soft-text"
                            onClick={onDiscard}
                        >
                            {t('notes.discardMarks')}
                        </button>
                    </div>
                </AlertDialog.Popup>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
}

/** The selection's colors: the accent and the surface, read once. */
function selectionInk(): { accent: string; surface: string } {
    const root = getComputedStyle(document.documentElement);
    return {
        accent: root.getPropertyValue('--ui-accent').trim(),
        surface: root.getPropertyValue('--ui-surface').trim(),
    };
}

/** The selected mark's outline and its tail's handle, in the accent, a CSS pixel wide. */
function drawSelection(
    context: CanvasRenderingContext2D,
    shape: MarkShape,
    handle: MarkPoint,
    scale: number,
    { accent, surface }: ReturnType<typeof selectionInk>,
) {
    const pixel = 1 / scale;
    const { label } = shape;
    const gap = 3 * pixel;
    context.save();
    context.strokeStyle = accent;
    context.lineWidth = 1.5 * pixel;
    context.setLineDash([4 * pixel, 3 * pixel]);
    context.strokeRect(label.x - gap, label.y - gap, label.width + gap * 2, label.height + gap * 2);
    context.setLineDash([]);
    context.beginPath();
    context.arc(handle.x, handle.y, HANDLE * pixel, 0, Math.PI * 2);
    context.fillStyle = surface;
    context.fill();
    context.stroke();
    context.restore();
}
