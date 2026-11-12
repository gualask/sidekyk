import type { PointerEvent } from 'react';
import {
    inImage,
    isInLabel,
    MAX_MARKS,
    type MarkShape,
    markAt,
    nextLetter,
    tailHandle,
    withMark,
    withoutMark,
} from '../../model/marks';
import type { Mark, MarkPoint } from '../../model/notes.types';
import { draftDrag } from './draft-drag';
import { HANDLE } from './draw-selection';

/**
 * In CSS pixels: how near a pointer is on a mark, and how near a tail's handle (`HANDLE`) it
 * takes it.
 */
const SLACK = 6;
const HANDLE_REACH = HANDLE + 3;

/** What a press acts with: the editor's view of the marks, and how it keeps a change. */
export interface PressContext {
    image: { width: number; height: number };
    scale: number;
    selected: number | null;
    /** A pointer's place in the image's pixels. */
    toImage: (event: { clientX: number; clientY: number }) => MarkPoint;
    shapesOf: (marks: readonly Mark[]) => MarkShape[];
    /** A step kept. */
    commit: (marks: Mark[]) => void;
    setDraft: (marks: Mark[] | null) => void;
    setSelected: (index: number | null) => void;
}

/** The index of the mark at `at` among `shapes`, at `scale`; -1 for none. */
export function markUnder(shapes: MarkShape[], at: MarkPoint, scale: number): number {
    return markAt(shapes, at, SLACK / scale);
}

/**
 * A press on the marks `base`: on the selected mark's handle it moves its tail, on a mark it
 * moves the mark, elsewhere it places the next letter.
 */
export function pressMarks(
    event: PointerEvent<HTMLCanvasElement>,
    base: Mark[],
    context: PressContext,
) {
    const { scale, selected: index } = context;
    const start = context.toImage(event);
    const shapes = context.shapesOf(base);
    const mark = index === null ? undefined : base[index];
    const shape = index === null ? undefined : shapes[index];
    if (mark && shape && index !== null && isNear(tailHandle(shape, mark), start, scale)) {
        dragTail(event, base, index, shape, context);
        return;
    }
    const hit = markUnder(shapes, start, scale);
    if (hit >= 0) {
        dragMark(event, base, hit, start, context);
        return;
    }
    if (base.length < MAX_MARKS) placeMark(event, base, start, context);
}

/** Whether `at` takes a tail's `handle`, at `scale`. */
function isNear(handle: MarkPoint, at: MarkPoint, scale: number): boolean {
    return Math.hypot(at.x - handle.x, at.y - handle.y) <= HANDLE_REACH / scale;
}

/**
 * Moves the tip of the tail of the mark at `index`; dropped on its label, the tail goes, and a
 * mark left without tail nor text with it.
 */
function dragTail(
    event: PointerEvent<HTMLCanvasElement>,
    base: Mark[],
    index: number,
    shape: MarkShape,
    { image, toImage, commit, setDraft, setSelected }: PressContext,
) {
    const mark = base[index];
    draftDrag(
        event,
        setDraft,
        (pointer) =>
            withMark(base, index, {
                ...mark,
                tail: inImage(toImage(pointer), image.width, image.height),
            }),
        (latest) => {
            const moved = latest?.[index];
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
}

/** Selects the mark at `hit` and moves it with the pointer, held where it was pressed. */
function dragMark(
    event: PointerEvent<HTMLCanvasElement>,
    base: Mark[],
    hit: number,
    start: MarkPoint,
    { image, toImage, commit, setDraft, setSelected }: PressContext,
) {
    setSelected(hit);
    const held = base[hit];
    const offset = { x: start.x - held.x, y: start.y - held.y };
    draftDrag(
        event,
        setDraft,
        (pointer) => {
            const at = toImage(pointer);
            const middle = inImage(
                { x: at.x - offset.x, y: at.y - offset.y },
                image.width,
                image.height,
            );
            return withMark(base, hit, { ...held, ...middle });
        },
        (moved) => {
            if (moved) commit(moved);
        },
    );
}

/**
 * Places the next letter: at `start` on a click, at the release of a drag with its tail pointing
 * back to `start`.
 */
function placeMark(
    event: PointerEvent<HTMLCanvasElement>,
    base: Mark[],
    start: MarkPoint,
    { image, toImage, commit, setDraft, setSelected }: PressContext,
) {
    const letter = nextLetter(base);
    const spot = inImage(start, image.width, image.height);
    draftDrag(
        event,
        setDraft,
        (pointer) => [
            ...base,
            { ...inImage(toImage(pointer), image.width, image.height), text: letter, tail: spot },
        ],
        (moved) => {
            commit(moved ?? [...base, { ...spot, text: letter, tail: null }]);
            setSelected(base.length);
        },
    );
}
