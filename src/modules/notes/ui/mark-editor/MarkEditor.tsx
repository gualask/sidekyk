import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { shortcutKey } from '@/shared/platform/shortcut';
import { useNotesPort } from '../../application/notes.port';
import {
    labelInside,
    type MarkShape,
    markHistory,
    markShape,
    markSize,
    redone,
    sameMarks,
    undone,
    withMarkText,
    withoutMark,
    withStep,
} from '../../model/marks';
import { sourceImage } from '../../model/notes';
import type { Mark, MarkPoint, NoteImage } from '../../model/notes.types';
import { DiscardDialog } from './DiscardDialog';
import { type MarkInk, markInk, textMeasure } from './drawing/draw-marks';
import { useMarksDrawing } from './drawing/use-marks-drawing';
import { EditorHeader } from './EditorHeader';
import { MarkField } from './MarkField';
import { markUnder, pressMarks } from './mark-press';
import { useFontReady } from './use-font-ready';
import { type Size, useRoom } from './use-room';

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
    const ink = useMemo(markInk, []);
    const size = markSize(width, height);
    const session = useMarkSession(initial, { width, height }, size, ink);
    const { marks, selected, editing } = session;
    const [saving, setSaving] = useState(false);
    // Cancel asked whether to drop what the session changed
    const [asking, setAsking] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const room = useRoom(stage);
    const fontReady = useFontReady(size, ink.family);
    // fitted, never scaled up
    const scale = room ? Math.min(1, room.width / width, room.height / height) : 0;
    const shown = { width: Math.floor(width * scale), height: Math.floor(height * scale) };

    useEffect(() => {
        root.current?.focus();
    }, []);

    // a capture meanwhile would open its marks in place of these: it only shows the window
    useEffect(() => {
        void port.setMarking(true).catch(() => undefined);
        return () => void port.setMarking(false).catch(() => undefined);
    }, [port]);

    // drawn in the font the PNG will have, once it is there
    useMarksDrawing(canvas, fontReady ? scale : 0, shown, { width, height }, ink, {
        marks,
        selected,
        editing,
    });

    /** A pointer's place in the image's pixels. */
    const toImage = (event: { clientX: number; clientY: number }): MarkPoint => {
        const rect = canvas.current?.getBoundingClientRect();
        return {
            x: (event.clientX - (rect?.left ?? 0)) / scale,
            y: (event.clientY - (rect?.top ?? 0)) / scale,
        };
    };

    const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 || saving) return;
        pressMarks(event, session.settled(), {
            image: { width, height },
            scale,
            selected,
            toImage,
            shapesOf: session.shapesOf,
            commit: session.commit,
            setDraft: session.setDraft,
            setSelected: session.setSelected,
        });
    };

    const onDoubleClick = (event: { clientX: number; clientY: number }) => {
        const hit = markUnder(session.shapesOf(session.present), toImage(event), scale);
        if (hit >= 0) session.edit(hit);
    };

    const done = async () => {
        if (saving) return;
        const final = session.settled();
        setSaving(true);
        const left = await onDone(sameMarks(final, initial) ? null : final);
        if (!left) setSaving(false);
    };

    /** Leaves without keeping the session's changes: asked first when there are any. */
    const cancel = () => {
        if (saving) return;
        if (sameMarks(session.pending(), initial)) onCancel();
        else setAsking(true);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // the field's keys are its own, the question's too (its keys reach here through React)
        if (event.target instanceof HTMLInputElement || asking) return;
        const command = keyCommand(event, selected, session.present);
        if (!command) return;
        event.preventDefault();
        if (command === 'cancel') cancel();
        else if (command === 'undo') session.step(undone);
        else if (command === 'redo') session.step(redone);
        else if (selected === null) return;
        else if (command === 'remove') session.remove(selected);
        else session.edit(selected);
    };

    const field = editing ? marks[editing.index] : undefined;

    return (
        <div
            ref={root}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col outline-none"
            onKeyDown={onKeyDown}
        >
            <EditorHeader
                place={place}
                saving={saving}
                onCancel={cancel}
                onDone={() => void done()}
            />
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
                        {editing && field ? (
                            <MarkField
                                key={editing.index}
                                mark={field}
                                text={editing.text}
                                size={size}
                                scale={scale}
                                ink={ink}
                                onChange={(text) =>
                                    session.setEditing({ index: editing.index, text })
                                }
                                onBlur={() => void session.settled()}
                                onKeep={() => {
                                    session.settled();
                                    root.current?.focus();
                                }}
                                onDrop={() => {
                                    session.setEditing(null);
                                    root.current?.focus();
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

/**
 * The session's marks on an image of `image`'s size, their labels `size` large in `ink`: their
 * history, the draft a drag shows over it, the mark selected and the text being written.
 */
function useMarkSession(initial: Mark[], image: Size, size: number, ink: MarkInk) {
    const [history, setHistory] = useState(() => markHistory(initial));
    const [draft, setDraft] = useState<Mark[] | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const present = history.present;

    /** The shapes of `list`, to find what a pointer is on: of the marks it acts on, not of the
     * last drawing, which may be behind them. */
    const shapesOf = (list: readonly Mark[]): MarkShape[] => {
        const measure = textMeasure(size, ink);
        return list.map((mark) => markShape(mark, size, measure));
    };

    /** A step kept, every label whole inside the image. */
    const commit = (next: Mark[]) => {
        const shapes = shapesOf(next);
        const inside = next.map((mark, index) =>
            labelInside(mark, shapes[index], image.width, image.height),
        );
        setHistory((h) => withStep(h, inside));
    };

    /** The marks with the text being written in. */
    const pending = (): Mark[] =>
        editing ? withMarkText(present, editing.index, editing.text) : present;

    /** The marks with the text being written kept, the field closed. */
    const settled = (): Mark[] => {
        if (!editing) return present;
        const next = pending();
        commit(next);
        setEditing(null);
        if (next.length < present.length) setSelected(null);
        return next;
    };

    return {
        present,
        /** What the canvas shows: the draft while a drag lasts. */
        marks: draft ?? present,
        selected,
        editing,
        shapesOf,
        commit,
        setDraft,
        setSelected,
        setEditing,
        pending,
        settled,
        /** Opens the field writing the text of the mark at `index`, selected. */
        edit: (index: number) => {
            setSelected(index);
            setEditing({ index, text: present[index].text });
        },
        step: (to: typeof undone) => {
            setHistory(to);
            setSelected(null);
        },
        /** Takes the mark at `index` out. */
        remove: (index: number) => {
            commit(withoutMark(present, index));
            setSelected(null);
        },
    };
}

type KeyCommand = 'cancel' | 'remove' | 'edit' | 'undo' | 'redo';

/** What a key on the editor does, `selected` the index of the mark selected in `marks`. */
function keyCommand(
    event: KeyboardEvent<HTMLDivElement>,
    selected: number | null,
    marks: readonly Mark[],
): KeyCommand | null {
    const shortcut = shortcutKey(event);
    if (event.key === 'Escape') return 'cancel';
    if ((event.key === 'Backspace' || event.key === 'Delete') && selected !== null) return 'remove';
    if (event.key === 'Enter' && selected !== null && marks[selected]) return 'edit';
    if (shortcut === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (shortcut === 'y') return 'redo';
    return null;
}
